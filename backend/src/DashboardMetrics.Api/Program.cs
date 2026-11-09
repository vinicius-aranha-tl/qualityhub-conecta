using DashboardMetrics.Infra;
using DashboardMetrics.Domain.Projects;
using DashboardMetrics.Domain.Widgets;
using DashboardMetrics.Domain.Metrics;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.RateLimiting;
using MongoDB.Driver;
using MongoDB.Bson;
using System.Security.Claims;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: false)
    .AddJsonFile("admin.local.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables();
builder.Services.AddMongoDatabase(builder.Configuration);
if (!builder.Environment.IsDevelopment())
{
    var encryptionKey = builder.Configuration["DataProtection:EncryptionKey"];
    if (string.IsNullOrWhiteSpace(encryptionKey)) throw new InvalidOperationException("Configure a chave de proteção de sessões.");
    builder.Services.AddSingleton<IXmlRepository>(provider => new MongoEncryptedXmlRepository(provider.GetRequiredService<IMongoDatabase>(), encryptionKey));
    builder.Services.AddDataProtection().SetApplicationName("QualityHub");
    builder.Services.AddOptions<KeyManagementOptions>().Configure<IXmlRepository>((options, repository) => options.XmlRepository = repository);
}
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
{
    options.Cookie.Name = "dashboardmetrics.session";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = false;
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options => options.AddFixedWindowLimiter("login", limiter =>
{
    limiter.PermitLimit = 5;
    limiter.Window = TimeSpan.FromMinutes(1);
    limiter.QueueLimit = 0;
}));

var app = builder.Build();
app.Use(async (context, next) =>
{
    if (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) || HttpMethods.IsDelete(context.Request.Method) || HttpMethods.IsPatch(context.Request.Method))
    {
        var origin = context.Request.Headers.Origin.ToString();
        var configured = app.Configuration.GetSection("Security:AllowedOrigins").Get<string[]>() ?? [];
        var local = app.Environment.IsDevelopment() ? new[] { "http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:8081", "http://127.0.0.1:8081" } : [];
        var self = $"{context.Request.Scheme}://{context.Request.Host}";
        if (!string.IsNullOrEmpty(origin) && !configured.Concat(local).Append(self).Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
    }
    await next();
});
app.UseRateLimiter();
app.UseAuthentication();
// A permission change or removal takes effect on the next request, including existing sessions.
app.Use(async (context, next) =>
{
    if (context.User.Identity?.IsAuthenticated == true && context.User.FindFirstValue(ClaimTypes.NameIdentifier) is string id && id != "local-admin")
    {
        var users = context.RequestServices.GetRequiredService<IMongoDatabase>().GetCollection<BsonDocument>("users");
        var user = await users.Find(Builders<BsonDocument>.Filter.Eq("_id", id)).FirstOrDefaultAsync(context.RequestAborted);
        if (user is null || user.GetValue("role", "").AsString != context.User.FindFirstValue(ClaimTypes.Role) ||
            PasswordVersion(user.GetValue("passwordHash", "").AsString) != context.User.FindFirstValue("password_version"))
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
    }
    await next();
});
app.UseAuthorization();

app.MapPost("/auth/login", async (LoginRequest request, HttpContext context, IConfiguration configuration, IMongoDatabase database) =>
{
    var email = configuration["AdminAuth:Email"];
    var hash = configuration["AdminAuth:PasswordHash"];
    var id = "local-admin";
    var role = "admin";
    if (!string.Equals(email, request.Email?.Trim(), StringComparison.OrdinalIgnoreCase))
    {
        var normalized = request.Email?.Trim().ToLowerInvariant() ?? "";
        var user = await database.GetCollection<BsonDocument>("users").Find(Builders<BsonDocument>.Filter.Eq("email", normalized)).FirstOrDefaultAsync(context.RequestAborted);
        if (user is null)
        {
            // Mesmo custo de verificação de um usuário existente, para não revelar e-mails cadastrados pelo tempo de resposta.
            new PasswordHasher<string>().VerifyHashedPassword(normalized, DummyPasswordHash.Value, request.Password ?? "");
            return Results.Unauthorized();
        }
        email = user["email"].AsString;
        hash = user["passwordHash"].AsString;
        role = user["role"].AsString;
        id = user["_id"].AsString;
    }
    if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(hash)) return Results.Unauthorized();
    var hasher = new PasswordHasher<string>();
    var result = hasher.VerifyHashedPassword(email, hash, request.Password ?? "");
    if (!string.Equals(email, request.Email?.Trim(), StringComparison.OrdinalIgnoreCase) || result == PasswordVerificationResult.Failed)
        return Results.Unauthorized();
    var identity = new ClaimsIdentity(new[] {
        new Claim(ClaimTypes.NameIdentifier, id),
        new Claim(ClaimTypes.Email, email),
        new Claim(ClaimTypes.Role, role),
        new Claim("password_version", PasswordVersion(hash))
    }, CookieAuthenticationDefaults.AuthenticationScheme);
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
    return Results.Ok(new { email, role });
}).RequireRateLimiting("login");

app.MapGet("/auth/me", (ClaimsPrincipal user) =>
    Results.Ok(new { email = user.FindFirstValue(ClaimTypes.Email), role = user.FindFirstValue(ClaimTypes.Role) })).RequireAuthorization();

app.MapPost("/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
}).RequireAuthorization();

var api = app.MapGroup("/api/v1").RequireAuthorization();
api.AddEndpointFilter(async (context, next) =>
{
    if (!HttpMethods.IsGet(context.HttpContext.Request.Method) && !context.HttpContext.User.IsInRole("admin")) return Results.Forbid();
    return await next(context);
});
api.MapGet("/metric-snapshots/{projectId}", async (string projectId, IMetricSnapshotRepository snapshots, IProjectRepository projects, CancellationToken ct) =>
{
    if (await projects.GetByIdAsync(projectId, ct) is null) return Results.NotFound();
    var json = await snapshots.GetLatestAsync(projectId, ct);
    return json is null ? Results.NotFound() : Results.Content(json, "application/json");
});
api.MapPut("/metric-snapshots/{projectId}", async (string projectId, System.Text.Json.JsonElement input, IMetricSnapshotRepository snapshots, IProjectRepository projects, CancellationToken ct) =>
{
    if (await projects.GetByIdAsync(projectId, ct) is null) return Results.NotFound();
    if (input.ValueKind != System.Text.Json.JsonValueKind.Object || !input.TryGetProperty("project", out var p) ||
        !p.TryGetProperty("id", out var id) || id.GetString() != projectId ||
        !input.TryGetProperty("executions", out var ex) || ex.ValueKind != System.Text.Json.JsonValueKind.Array ||
        !input.TryGetProperty("sources", out var sources) || sources.ValueKind != System.Text.Json.JsonValueKind.Object ||
        !input.TryGetProperty("evolution", out var ev) || ev.ValueKind != System.Text.Json.JsonValueKind.Object ||
        !input.TryGetProperty("special", out var sp) || sp.ValueKind != System.Text.Json.JsonValueKind.Object ||
        !input.TryGetProperty("sourceFingerprint", out var fingerprint) || fingerprint.ValueKind != System.Text.Json.JsonValueKind.String ||
        string.IsNullOrWhiteSpace(fingerprint.GetString())) return Results.BadRequest();
    var json = input.GetRawText();
    if (System.Text.Encoding.UTF8.GetByteCount(json) > 12_000_000) return Results.BadRequest(new { message = "Captura excede o tamanho permitido." });
    await snapshots.SaveAsync(projectId, json, ct);
    return Results.NoContent();
});
var usersApi = api.MapGroup("/users").RequireAuthorization(policy => policy.RequireRole("admin"));
usersApi.MapGet("/", async (IMongoDatabase db, CancellationToken ct) =>
    Results.Ok((await db.GetCollection<BsonDocument>("users").Find(FilterDefinition<BsonDocument>.Empty).ToListAsync(ct))
        .Select(u => new { id = u["_id"].AsString, email = u["email"].AsString, role = u["role"].AsString })));
usersApi.MapPost("/", async (UserInput input, IMongoDatabase db, IConfiguration config, CancellationToken ct) =>
{
    var email = input.Email?.Trim().ToLowerInvariant() ?? "";
    if (!ValidUser(email, input.Role) || string.IsNullOrWhiteSpace(input.Password) || input.Password.Length < 8 || input.Password.Length > 256) return Results.BadRequest(new { message = "Informe um e-mail válido, perfil e senha com pelo menos 8 caracteres." });
    if (string.Equals(email, config["AdminAuth:Email"], StringComparison.OrdinalIgnoreCase)) return Results.Conflict(new { message = "Este e-mail pertence ao administrador principal." });
    var users = db.GetCollection<BsonDocument>("users");
    await users.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(Builders<BsonDocument>.IndexKeys.Ascending("email"), new CreateIndexOptions { Unique = true }), cancellationToken: ct);
    var id = Guid.NewGuid().ToString();
    var doc = new BsonDocument { { "_id", id }, { "email", email }, { "role", input.Role! }, { "passwordHash", new PasswordHasher<string>().HashPassword(email, input.Password) } };
    try { await users.InsertOneAsync(doc, cancellationToken: ct); }
    catch (MongoWriteException ex) when (ex.WriteError.Category == ServerErrorCategory.DuplicateKey) { return Results.Conflict(new { message = "E-mail já cadastrado." }); }
    return Results.Ok(new { id, email, role = input.Role });
});
usersApi.MapPut("/{id}", async (string id, UserInput input, IMongoDatabase db, CancellationToken ct) =>
{
    if (input.Role is not ("viewer" or "admin")) return Results.BadRequest();
    var update = Builders<BsonDocument>.Update.Set("role", input.Role);
    if (!string.IsNullOrEmpty(input.Password))
    {
        if (input.Password.Length < 8 || input.Password.Length > 256) return Results.BadRequest(new { message = "A senha deve ter pelo menos 8 caracteres." });
        var current = await db.GetCollection<BsonDocument>("users").Find(Builders<BsonDocument>.Filter.Eq("_id", id)).FirstOrDefaultAsync(ct);
        if (current is null) return Results.NotFound();
        update = update.Set("passwordHash", new PasswordHasher<string>().HashPassword(current["email"].AsString, input.Password));
    }
    var result = await db.GetCollection<BsonDocument>("users").UpdateOneAsync(Builders<BsonDocument>.Filter.Eq("_id", id), update, cancellationToken: ct);
    return result.MatchedCount == 0 ? Results.NotFound() : Results.NoContent();
});
usersApi.MapDelete("/{id}", async (string id, IMongoDatabase db, CancellationToken ct) =>
    (await db.GetCollection<BsonDocument>("users").DeleteOneAsync(Builders<BsonDocument>.Filter.Eq("_id", id), ct)).DeletedCount == 0 ? Results.NotFound() : Results.NoContent());
api.MapPost("/setup/recomenda", async (IMongoDatabase database, IProjectRepository projects, CancellationToken cancellationToken) =>
{
    var settings = database.GetCollection<MongoDB.Bson.BsonDocument>("app_settings");
    var marker = Builders<MongoDB.Bson.BsonDocument>.Filter.Eq("_id", "initial-project-v1");
    if (await settings.Find(marker).AnyAsync(cancellationToken)) return Results.NoContent();
    if ((await projects.ListAsync(cancellationToken)).Count == 0)
    {
        var project = new Project {
            Name = "Conecta Recomenda", Slug = "conecta-recomenda",
            Description = "Métricas de automação do Recomenda.",
            ApiRepoOwner = "Conecta-ag", ApiRepoName = "api-automation-recomenda-test",
            UiRepoOwner = "Conecta-ag", UiRepoName = "ui-automation-recomenda-test"
        };
        try { await projects.InsertAsync(project, cancellationToken); }
        catch (MongoWriteException ex) when (ex.WriteError.Category == ServerErrorCategory.DuplicateKey) { }
    }
    await settings.UpdateOneAsync(marker, Builders<MongoDB.Bson.BsonDocument>.Update.Set("completedAt", DateTime.UtcNow),
        new UpdateOptions { IsUpsert = true }, cancellationToken);
    return Results.NoContent();
});
api.MapGet("/projects", async (IProjectRepository projects, CancellationToken cancellationToken) =>
    Results.Ok(await projects.ListAsync(cancellationToken)));
api.MapGet("/projects/{slug}", async (string slug, IProjectRepository projects, CancellationToken cancellationToken) =>
{
    var project = await projects.GetBySlugAsync(slug, cancellationToken);
    return project is null ? Results.NotFound() : Results.Ok(project);
});
api.MapPost("/projects", async (ProjectInput input, IProjectRepository projects, CancellationToken cancellationToken) =>
{
    if (!input.Valid()) return Results.BadRequest(new { message = "Dados do projeto inválidos." });
    var project = new Project { Name = input.Name.Trim(), Slug = input.Slug.Trim(), Description = input.Description?.Trim() ?? "" };
    input.ApplySources(project);
    try { await projects.InsertAsync(project, cancellationToken); }
    catch (MongoWriteException ex) when (ex.WriteError.Category == ServerErrorCategory.DuplicateKey)
    { return Results.Conflict(new { message = "Já existe um projeto com esse identificador." }); }
    return Results.Created($"/api/v1/projects/{project.Slug}", project);
});
api.MapPut("/projects/by-id/{id}", async (string id, ProjectInput input, IProjectRepository projects, CancellationToken cancellationToken) =>
{
    if (!input.Valid()) return Results.BadRequest(new { message = "Dados do projeto inválidos." });
    var project = await projects.GetByIdAsync(id, cancellationToken);
    if (project is null) return Results.NotFound();
    project.Name = input.Name.Trim();
    project.Slug = input.Slug.Trim();
    project.Description = input.Description?.Trim() ?? "";
    project.UpdatedAt = DateTime.UtcNow;
    input.ApplySources(project);
    try { return await projects.ReplaceAsync(project, cancellationToken) ? Results.Ok(project) : Results.NotFound(); }
    catch (MongoWriteException ex) when (ex.WriteError.Category == ServerErrorCategory.DuplicateKey)
    { return Results.Conflict(new { message = "Já existe um projeto com esse identificador." }); }
});
api.MapDelete("/projects/by-id/{id}", async (string id, IProjectRepository projects, IWidgetRepository widgets, CancellationToken cancellationToken) =>
{
    var project = await projects.GetByIdAsync(id, cancellationToken);
    if (project is null) return Results.NotFound();
    await widgets.DeleteProjectAsync(id, cancellationToken);
    return await projects.DeleteAsync(id, cancellationToken) ? Results.NoContent() : Results.NotFound();
});
api.MapGet("/widgets", async (string? projectId, string product, IWidgetRepository widgets, CancellationToken cancellationToken) =>
{
    if (product is not ("api" or "ui")) return Results.BadRequest();
    return Results.Ok(await widgets.ListAsync(projectId, product, cancellationToken));
});
api.MapPost("/widgets", async (WidgetInput input, IWidgetRepository widgets, IProjectRepository projects, CancellationToken cancellationToken) =>
{
    if (!input.Valid()) return Results.BadRequest();
    if (input.ProjectId is not null && await projects.GetByIdAsync(input.ProjectId, cancellationToken) is null) return Results.NotFound();
    var widget = new DashboardWidget { ProjectId = input.ProjectId, Product = input.Product, WidgetType = input.WidgetType, Title = input.Title.Trim(), Width = input.Width, Position = input.Position };
    await widgets.InsertAsync(widget, cancellationToken);
    return Results.Created($"/api/v1/widgets/{widget.Id}", widget);
});
api.MapPut("/widgets/{id}", async (string id, WidgetInput input, IWidgetRepository widgets, IProjectRepository projects, CancellationToken cancellationToken) =>
{
    if (!input.Valid()) return Results.BadRequest();
    var widget = await widgets.GetByIdAsync(id, cancellationToken);
    if (widget is null) return Results.NotFound();
    if (widget.ProjectId != input.ProjectId || widget.Product != input.Product) return Results.BadRequest();
    widget.Title = input.Title.Trim(); widget.WidgetType = input.WidgetType; widget.Width = input.Width; widget.Position = input.Position;
    return await widgets.ReplaceAsync(widget, cancellationToken) ? Results.Ok(widget) : Results.NotFound();
});
api.MapDelete("/widgets/{id}", async (string id, IWidgetRepository widgets, CancellationToken cancellationToken) =>
    await widgets.DeleteAsync(id, cancellationToken) ? Results.NoContent() : Results.NotFound());
api.MapDelete("/widgets", async (string? projectId, string product, IWidgetRepository widgets, CancellationToken cancellationToken) =>
{
    if (product is not ("api" or "ui")) return Results.BadRequest();
    await widgets.DeleteScopeAsync(projectId, product, cancellationToken);
    return Results.NoContent();
});
app.MapGet("/health/mongodb", async (IMongoDatabase database, CancellationToken cancellationToken) =>
{
    try
    {
        await database.RunCommandAsync<MongoDB.Bson.BsonDocument>(
            new MongoDB.Bson.BsonDocument("ping", 1), cancellationToken: cancellationToken);
        return Results.Ok(new { status = "connected" });
    }
    catch (MongoException)
    {
        return Results.Problem("MongoDB indisponível.", statusCode: 503);
    }
});
app.Run();

static bool ValidUser(string email, string? role) => role is "viewer" or "admin" && email.Length <= 254 && System.Net.Mail.MailAddress.TryCreate(email, out var parsed) && parsed.Address == email;
static string PasswordVersion(string hash) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(hash)));
static class DummyPasswordHash
{
    public static readonly string Value = new PasswordHasher<string>().HashPassword("timing-guard", Guid.NewGuid().ToString());
}
record UserInput(string? Email, string? Role, string? Password);
record LoginRequest(string? Email, string? Password);
record WidgetInput(string? ProjectId, string Product, string WidgetType, string Title, string Width, int Position)
{
    public bool Valid() => Product is "api" or "ui" && Width is "half" or "full" &&
        !string.IsNullOrWhiteSpace(WidgetType) && WidgetType.Length <= 100 &&
        !string.IsNullOrWhiteSpace(Title) && Title.Length <= 120 && Position >= 0;
}

record ProjectInput(string Name, string Slug, string? Description,
    string? ApiRepoOwner, string? ApiRepoName, string? ApiBranch,
    string? UiRepoOwner, string? UiRepoName, string? UiBranch)
{
    public bool Valid() => !string.IsNullOrWhiteSpace(Name) && Name.Length <= 80 &&
        !string.IsNullOrWhiteSpace(Slug) && Slug.Length <= 100 &&
        System.Text.RegularExpressions.Regex.IsMatch(Slug, "^[a-z0-9]+(?:-[a-z0-9]+)*$") &&
        (Description?.Length ?? 0) <= 300 &&
        ValidRepo(ApiRepoOwner) && ValidRepo(ApiRepoName) && ValidRepo(UiRepoOwner) && ValidRepo(UiRepoName) &&
        ValidBranch(ApiBranch) && ValidBranch(UiBranch);
    private static bool ValidRepo(string? value) => string.IsNullOrEmpty(value) ||
        (value.Length <= 100 && System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z0-9_.-]+$"));
    private static bool ValidBranch(string? value) => string.IsNullOrEmpty(value) ||
        (value.Length <= 100 && System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z0-9_./-]+$"));
    public void ApplySources(Project project)
    {
        project.ApiRepoOwner = ApiRepoOwner; project.ApiRepoName = ApiRepoName;
        project.ApiBranch = string.IsNullOrWhiteSpace(ApiBranch) ? "automation-metrics" : ApiBranch;
        project.UiRepoOwner = UiRepoOwner; project.UiRepoName = UiRepoName;
        project.UiBranch = string.IsNullOrWhiteSpace(UiBranch) ? "automation-metrics" : UiBranch;
    }
}
