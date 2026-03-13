using System.Security.Claims;
using System.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UploadsController(SocialSezContext dbContext) : ControllerBase
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif"
    };

    [Authorize]
    [HttpPost("images")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<ActionResult<UploadImageResponse>> UploadImage([FromForm] UploadImageRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var file = request.File;
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { message = "Image file is required." });
        }

        var extension = Path.GetExtension(file.FileName);
        if (!AllowedExtensions.Contains(extension))
        {
            return BadRequest(new { message = "Only image files are allowed (.jpg, .jpeg, .png, .webp, .gif)." });
        }

        await using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, cancellationToken);

        var image = new UploadedImage
        {
            Id = Guid.NewGuid(),
            UploadedByProfileId = profileId,
            ContentType = NormalizeContentType(file.ContentType, extension),
            OriginalFileName = Path.GetFileName(file.FileName),
            FileExtension = extension.ToLowerInvariant(),
            Content = memoryStream.ToArray(),
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.UploadedImages.Add(image);
        await dbContext.SaveChangesAsync(cancellationToken);

        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : string.Empty;
        var relativePath = $"{pathBase}/api/uploads/images/{image.Id:D}";
        var url = $"{Request.Scheme}://{Request.Host}{relativePath}";
        return Ok(new UploadImageResponse(url));
    }

    [AllowAnonymous]
    [HttpGet("images/{id:guid}")]
    [HttpGet("/uploads/images/{id:guid}")]
    public async Task<IActionResult> GetImage(Guid id, CancellationToken cancellationToken)
    {
        var image = await dbContext.UploadedImages
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (image is null)
        {
            return NotFound();
        }

        if (RequiresVideoTranscode(image))
        {
            var transcoded = await TryTranscodeVideoToMp4Async(image.Content, image.FileExtension, cancellationToken);
            if (transcoded is not null)
            {
                image.Content = transcoded.Value.Content;
                image.ContentType = "video/mp4";
                image.FileExtension = ".mp4";
                image.OriginalFileName = Path.ChangeExtension(image.OriginalFileName, ".mp4") ?? "media.mp4";
                await dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        Response.Headers.CacheControl = "public,max-age=31536000,immutable";
        return File(image.Content, image.ContentType);
    }

    private static bool RequiresVideoTranscode(UploadedImage image)
    {
        var contentType = image.ContentType?.Trim() ?? string.Empty;
        var extension = image.FileExtension?.Trim().ToLowerInvariant() ?? string.Empty;

        if (!contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (string.Equals(contentType, "video/mp4", StringComparison.OrdinalIgnoreCase)
            || string.Equals(contentType, "video/webm", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return extension is ".mov" or ".m4v" or ".ogv";
    }

    private static async Task<(byte[] Content, string ContentType)?> TryTranscodeVideoToMp4Async(byte[] inputContent, string? inputExtension, CancellationToken cancellationToken)
    {
        var ffmpegExecutable = ResolveFfmpegExecutable();
        if (string.IsNullOrWhiteSpace(ffmpegExecutable) || inputContent.Length == 0)
        {
            return null;
        }

        var extension = string.IsNullOrWhiteSpace(inputExtension) ? ".bin" : inputExtension;
        if (!extension.StartsWith('.'))
        {
            extension = $".{extension}";
        }

        var inputPath = Path.Combine(Path.GetTempPath(), $"socialsez-media-{Guid.NewGuid():N}{extension}");
        var outputPath = Path.Combine(Path.GetTempPath(), $"socialsez-media-{Guid.NewGuid():N}.mp4");

        try
        {
            await System.IO.File.WriteAllBytesAsync(inputPath, inputContent, cancellationToken);

            var startInfo = new ProcessStartInfo
            {
                FileName = ffmpegExecutable,
                Arguments = $"-y -i \"{inputPath}\" -movflags +faststart -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k \"{outputPath}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(startInfo);
            if (process is null)
            {
                return null;
            }

            await process.WaitForExitAsync(cancellationToken);
            if (process.ExitCode != 0 || !System.IO.File.Exists(outputPath))
            {
                return null;
            }

            var output = await System.IO.File.ReadAllBytesAsync(outputPath, cancellationToken);
            if (output.Length == 0)
            {
                return null;
            }

            return (output, "video/mp4");
        }
        catch
        {
            return null;
        }
        finally
        {
            try
            {
                if (System.IO.File.Exists(inputPath))
                {
                    System.IO.File.Delete(inputPath);
                }
            }
            catch
            {
            }

            try
            {
                if (System.IO.File.Exists(outputPath))
                {
                    System.IO.File.Delete(outputPath);
                }
            }
            catch
            {
            }
        }
    }

    private static string? ResolveFfmpegExecutable()
    {
        if (IsCommandAvailable("ffmpeg"))
        {
            return "ffmpeg";
        }

        var localFfmpeg = Path.Combine(AppContext.BaseDirectory, "ffmpeg", "ffmpeg.exe");
        if (System.IO.File.Exists(localFfmpeg))
        {
            return localFfmpeg;
        }

        return null;
    }

    private static bool IsCommandAvailable(string command)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = command,
                Arguments = "-version",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });

            if (process is null)
            {
                return false;
            }

            process.WaitForExit(2000);
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }

    private static string NormalizeContentType(string? contentType, string extension)
    {
        if (!string.IsNullOrWhiteSpace(contentType) && contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return contentType;
        }

        return extension.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            _ => "image/jpeg"
        };
    }

    public sealed record UploadImageResponse(string Url);

    public sealed record UploadImageRequest(IFormFile? File);
}