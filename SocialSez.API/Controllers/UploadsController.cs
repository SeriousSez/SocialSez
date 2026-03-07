using System.Security.Claims;
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
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (image is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "public,max-age=31536000,immutable";
        return File(image.Content, image.ContentType);
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