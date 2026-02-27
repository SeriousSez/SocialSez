namespace SocialSez.API.Infrastructure;

public static class UploadsRootResolver
{
    public static string Resolve(IConfiguration configuration, IWebHostEnvironment environment)
    {
        var fallback = Path.Combine(
            environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"),
            "uploads");

        var configuredUploadsRoot = configuration["Uploads:RootPath"];
        if (!string.IsNullOrWhiteSpace(configuredUploadsRoot))
        {
            var configuredPath = Path.IsPathRooted(configuredUploadsRoot)
                ? configuredUploadsRoot
                : Path.GetFullPath(configuredUploadsRoot, environment.ContentRootPath);

            if (TryEnsureWritableDirectory(configuredPath))
            {
                return configuredPath;
            }
        }

        return TryEnsureWritableDirectory(fallback)
            ? fallback
            : environment.ContentRootPath;
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
