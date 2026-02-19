using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace SocialSez.Infrastructure.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddSocialSezInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
#if DEBUG
        var sqliteConnectionString = configuration.GetConnectionString("Sqlite")
            ?? "Data Source=socialsez.dev.db";

        services.AddDbContext<SocialSezContext>(options => options.UseSqlite(sqliteConnectionString));
#else
        var connectionString = configuration.GetConnectionString("MySql")
            ?? throw new InvalidOperationException("Connection string 'MySql' was not found.");

        services.AddDbContext<SocialSezContext>(options =>
            options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));
#endif

        return services;
    }
}
