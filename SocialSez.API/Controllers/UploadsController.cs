using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.API.Infrastructure;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UploadsController(IWebHostEnvironment environment, IConfiguration configuration) : ControllerBase
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

        var uploadsRoot = Path.Combine(ResolveUploadsRoot(), "images");
        Directory.CreateDirectory(uploadsRoot);

        var safeFileName = $"{profileId:N}-{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var absoluteFilePath = Path.Combine(uploadsRoot, safeFileName);

        await using (var stream = System.IO.File.Create(absoluteFilePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var relativePath = $"/uploads/images/{safeFileName}";
        var url = $"{Request.Scheme}://{Request.Host}{relativePath}";
        return Ok(new UploadImageResponse(url));
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }

    private string ResolveUploadsRoot()
    {
        return UploadsRootResolver.Resolve(configuration, environment);
    }

    public sealed record UploadImageResponse(string Url);

    public sealed record UploadImageRequest(IFormFile? File);
}