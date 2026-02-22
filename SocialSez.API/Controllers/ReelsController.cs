using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ReelsController(IReelService reelService, IWebHostEnvironment environment) : ControllerBase
{
    [Authorize]
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(512 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 512 * 1024 * 1024)]
    public async Task<ActionResult<ReelDto>> Create([FromForm] CreateReelFormRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            if (request.Video is null || request.Video.Length <= 0)
            {
                return BadRequest(new { message = "Reel video is required." });
            }

            var videoUrl = await SaveVideoAsync(profileId, request.Video, cancellationToken);
            string? thumbnailUrl = null;

            if (request.Thumbnail is not null && request.Thumbnail.Length > 0)
            {
                thumbnailUrl = await SaveThumbnailAsync(profileId, request.Thumbnail, cancellationToken);
            }

            var reel = await reelService.CreateAsync(
                new CreateReelRequest(profileId, request.Caption, videoUrl, thumbnailUrl, request.DurationSeconds),
                cancellationToken);

            return Ok(reel);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpDelete("{reelId:guid}")]
    public async Task<IActionResult> Delete(Guid reelId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var deleted = await reelService.DeleteAsync(reelId, profileId, cancellationToken);
            return deleted ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("{reelId:guid}/like")]
    public async Task<ActionResult<ReelDto>> ToggleLike(Guid reelId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var reel = await reelService.ToggleLikeAsync(reelId, profileId, cancellationToken);
        return reel is null ? NotFound() : Ok(reel);
    }

    [Authorize]
    [HttpGet("feed")]
    public async Task<ActionResult<IReadOnlyCollection<ReelDto>>> GetFeed([FromQuery] int take = 25, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var feed = await reelService.GetFeedAsync(profileId, take, cancellationToken);
        return Ok(feed);
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }

    private async Task<string> SaveVideoAsync(Guid profileId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (!AllowedVideoExtensions.Contains(extension))
        {
            throw new ArgumentException("Allowed reel video files: .mp4, .webm, .mov, .m4v, .ogv.");
        }

        var uploadsRoot = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "uploads", "reels");
        Directory.CreateDirectory(uploadsRoot);

        var safeFileName = $"reel-{profileId:N}-{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var absoluteFilePath = Path.Combine(uploadsRoot, safeFileName);

        await using (var stream = System.IO.File.Create(absoluteFilePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        return $"{Request.Scheme}://{Request.Host}/uploads/reels/{safeFileName}";
    }

    private async Task<string> SaveThumbnailAsync(Guid profileId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (!AllowedImageExtensions.Contains(extension))
        {
            throw new ArgumentException("Allowed thumbnail files: .jpg, .jpeg, .png, .webp.");
        }

        var uploadsRoot = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "uploads", "reels", "thumbs");
        Directory.CreateDirectory(uploadsRoot);

        var safeFileName = $"reel-thumb-{profileId:N}-{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var absoluteFilePath = Path.Combine(uploadsRoot, safeFileName);

        await using (var stream = System.IO.File.Create(absoluteFilePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        return $"{Request.Scheme}://{Request.Host}/uploads/reels/thumbs/{safeFileName}";
    }

    private static readonly HashSet<string> AllowedVideoExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp4", ".webm", ".mov", ".m4v", ".ogv"
    };

    private static readonly HashSet<string> AllowedImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp"
    };

    public sealed record CreateReelFormRequest(string? Caption, int DurationSeconds, IFormFile? Video, IFormFile? Thumbnail);
}
