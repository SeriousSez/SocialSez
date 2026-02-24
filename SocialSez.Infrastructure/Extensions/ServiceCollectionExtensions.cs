using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace SocialSez.Infrastructure.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddSocialSezInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var provider = configuration["Database:Provider"]?.Trim();
        var mysqlConnectionString = configuration.GetConnectionString("MySql");
        var sqliteConnectionString = configuration.GetConnectionString("Sqlite");

        if (string.IsNullOrWhiteSpace(provider))
        {
            provider = !string.IsNullOrWhiteSpace(mysqlConnectionString)
                ? "MySql"
                : !string.IsNullOrWhiteSpace(sqliteConnectionString)
                    ? "Sqlite"
                    : "MySql";
        }

        if (provider.Equals("MySql", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(mysqlConnectionString))
            {
                throw new InvalidOperationException("Connection string 'MySql' was not found or is empty.");
            }

            services.AddDbContext<SocialSezContext>(options =>
                options.UseMySql(mysqlConnectionString, ServerVersion.AutoDetect(mysqlConnectionString)));
        }
        else
        {
            if (string.IsNullOrWhiteSpace(sqliteConnectionString))
            {
                throw new InvalidOperationException("Connection string 'Sqlite' was not found or is empty.");
            }

            services.AddDbContext<SocialSezContext>(options => options.UseSqlite(sqliteConnectionString));
        }

        return services;
    }
}
