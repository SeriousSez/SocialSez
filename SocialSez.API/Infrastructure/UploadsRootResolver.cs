using Microsoft.Extensions.FileProviders;

namespace SocialSez.API.Infrastructure;

public static class UploadsRootResolver
{
    public static string Resolve(IConfiguration configuration, IWebHostEnvironment environment)
    {
        var configuredUploadsRoot = configuration["Uploads:RootPath"];
        if (!string.IsNullOrWhiteSpace(configuredUploadsRoot))
        {
            return Path.IsPathRooted(configuredUploadsRoot)
                ? configuredUploadsRoot
                : Path.GetFullPath(configuredUploadsRoot, environment.ContentRootPath);
        }

        var fallback = Path.Combine(
            environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"),
            "uploads");

        if (OperatingSystem.IsWindows() || environment.IsDevelopment())
        {
            return fallback;
        }

        var candidates = BuildProductionCandidates(environment.ContentRootPath);
        foreach (var candidate in candidates)
        {
            if (TryEnsureWritableDirectory(candidate))
            {
                return candidate;
            }
        }

        return fallback;
    }

    private static IEnumerable<string> BuildProductionCandidates(string contentRootPath)
    {
        yield return "/venli.uploads";

        yield return Path.GetFullPath(
            Path.Combine(contentRootPath, "..", "venli.uploads"));

        var homeDirectory = Environment.GetEnvironmentVariable("HOME");
        if (!string.IsNullOrWhiteSpace(homeDirectory))
        {
            yield return Path.Combine(homeDirectory, "venli.uploads");
        }

        yield return Path.Combine(contentRootPath, "venli.uploads");
    }

    private static bool TryEnsureWritableDirectory(string path)
    {
        try
        {
            Directory.CreateDirectory(path);

            var probeFile = Path.Combine(path, $".write-test-{Guid.NewGuid():N}.tmp");
            File.WriteAllText(probeFile, "ok");
            File.Delete(probeFile);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
