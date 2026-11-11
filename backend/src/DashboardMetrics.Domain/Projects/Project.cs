namespace DashboardMetrics.Domain.Projects;

public sealed class Project
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Description { get; set; } = "";
    /// <summary>Frentes testadas: "api-ui", "api" (só back-end) ou "ui" (só front-end). Projetos antigos sem o campo são "api-ui".</summary>
    public string Fronts { get; set; } = ProjectFronts.ApiUi;
    public string? ApiRepoOwner { get; set; }
    public string? ApiRepoName { get; set; }
    public string ApiBranch { get; set; } = "automation-metrics";
    public string? UiRepoOwner { get; set; }
    public string? UiRepoName { get; set; }
    public string UiBranch { get; set; } = "automation-metrics";
    public string? ApiExecutionsUrl { get; set; }
    public string? ApiEvolutionUrl { get; set; }
    public string? UiExecutionsUrl { get; set; }
    public string? UiEvolutionUrl { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSyncedAt { get; set; }
    public string? LastSyncError { get; set; }
}

public static class ProjectFronts
{
    public const string ApiUi = "api-ui";
    public const string Api = "api";
    public const string Ui = "ui";
    public static bool IsValid(string? value) => value is ApiUi or Api or Ui;
    public static bool HasApi(string value) => value is ApiUi or Api;
    public static bool HasUi(string value) => value is ApiUi or Ui;
}
