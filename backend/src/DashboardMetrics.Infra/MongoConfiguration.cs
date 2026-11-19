using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Driver;
using DashboardMetrics.Domain.Projects;
using DashboardMetrics.Domain.Widgets;
using DashboardMetrics.Domain.Metrics;

namespace DashboardMetrics.Infra;

public static class MongoConfiguration
{
    public static IServiceCollection AddMongoDatabase(this IServiceCollection services, IConfiguration configuration)
    {
        var connection = configuration["MongoDbOptions:ConnectionString"]
            ?? throw new InvalidOperationException("Configure a conexão do MongoDB.");
        var name = configuration["MongoDbOptions:DatabaseName"]
            ?? throw new InvalidOperationException("Configure o nome do banco MongoDB.");
        services.AddSingleton<IMongoClient>(_ =>
        {
            var settings = MongoClientSettings.FromConnectionString(connection);
            // As capturas de métricas têm alguns MB de JSON repetitivo: comprimir o tráfego com o Atlas
            // reduz bastante o tempo de leitura e gravação. Quem já define `compressors` na conexão prevalece.
            if (settings.Compressors.Count == 0)
                settings.Compressors = [new MongoDB.Driver.Core.Configuration.CompressorConfiguration(MongoDB.Driver.Core.Compression.CompressorType.Zlib)];
            return new MongoClient(settings);
        });
        services.AddSingleton(provider => provider.GetRequiredService<IMongoClient>().GetDatabase(name));
        services.AddScoped<IProjectRepository, MongoProjectRepository>();
        services.AddScoped<IWidgetRepository, MongoWidgetRepository>();
        services.AddScoped<IMetricSnapshotRepository, MongoMetricSnapshotRepository>();
        return services;
    }
}
