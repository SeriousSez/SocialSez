using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace SocialSez.Infrastructure.Extensions;

public static class ServiceCollectionExtensions
{
    private static readonly MySqlServerVersion DefaultMySqlServerVersion = new(new Version(8, 0, 36));

    public static IServiceCollection AddSocialSezInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var provider = FirstNonEmpty(
            configuration["Database:Provider"],
            configuration["Database__Provider"]
        )?.Trim();

        var mysqlConnectionString = FirstNonEmpty(
            configuration.GetConnectionString("MySql"),
            configuration["ConnectionStrings:MySql"],
            configuration["ConnectionStrings__MySql"],
            configuration["MYSQLCONNSTR_MySql"],
            configuration["MYSQLCONNSTR_DefaultConnection"],
            configuration.GetConnectionString("DefaultConnection"),
            configuration["Database:MySqlConnectionString"],
            configuration["Database__MySqlConnectionString"]
        );

        var sqliteConnectionString = FirstNonEmpty(
            configuration.GetConnectionString("Sqlite"),
            configuration["ConnectionStrings:Sqlite"],
            configuration["ConnectionStrings__Sqlite"],
            configuration["SQLITECONNSTR_Sqlite"],
            configuration["Database:SqliteConnectionString"],
            configuration["Database__SqliteConnectionString"]
        );

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

            var configuredMySqlVersion = FirstNonEmpty(
                configuration["Database:MySqlServerVersion"],
                configuration["Database__MySqlServerVersion"],
                configuration["MYSQL_SERVER_VERSION"]
            );

            var mysqlServerVersion = ParseMySqlServerVersion(configuredMySqlVersion) ?? DefaultMySqlServerVersion;

            services.AddDbContext<SocialSezContext>(options =>
                options.UseMySql(mysqlConnectionString, mysqlServerVersion));
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

    private static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }

    private static MySqlServerVersion? ParseMySqlServerVersion(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        var dashIndex = normalized.IndexOf('-');
        if (dashIndex >= 0)
        {
            normalized = normalized[..dashIndex];
        }

        if (Version.TryParse(normalized, out var parsedVersion))
        {
            return new MySqlServerVersion(parsedVersion);
        }

        return null;
    }
}
