using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace SocialSez.Infrastructure.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddSocialSezInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var provider = (configuration["Database:Provider"] ?? "Sqlite").Trim();

        if (provider.Equals("MySql", StringComparison.OrdinalIgnoreCase))
        {
            var connectionString = configuration.GetConnectionString("MySql")
                ?? throw new InvalidOperationException("Connection string 'MySql' was not found.");

            services.AddDbContext<SocialSezContext>(options =>
                options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));
        }
        else
        {
            var sqliteConnectionString = configuration.GetConnectionString("Sqlite")
                ?? "Data Source=socialsez.dev.db";

            services.AddDbContext<SocialSezContext>(options => options.UseSqlite(sqliteConnectionString));
        }

        return services;
    }
}
