using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ReelsController(IReelService reelService, SocialSezContext dbContext) : ControllerBase
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
    [HttpPut("{reelId:guid}")]
    public async Task<ActionResult<ReelDto>> Update(Guid reelId, [FromBody] UpdateReelBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await reelService.UpdateAsync(reelId, profileId, new UpdateReelRequest(request.Caption), cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
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
    [HttpPost("{reelId:guid}/comments")]
    public async Task<ActionResult<ReelDto>> AddComment(Guid reelId, [FromBody] CreateReelCommentBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await reelService.AddCommentAsync(reelId, new CreateReelCommentRequest(profileId, request.Content, request.ParentCommentId), cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
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
    [HttpPut("{reelId:guid}/comments/{commentId:guid}")]
    public async Task<ActionResult<ReelDto>> UpdateComment(Guid reelId, Guid commentId, [FromBody] UpdateReelCommentBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await reelService.UpdateCommentAsync(reelId, commentId, profileId, new UpdateReelCommentRequest(request.Content), cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpDelete("{reelId:guid}/comments/{commentId:guid}")]
    public async Task<ActionResult<ReelDto>> DeleteComment(Guid reelId, Guid commentId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await reelService.DeleteCommentAsync(reelId, commentId, profileId, cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("{reelId:guid}/comments/{commentId:guid}/like")]
    public async Task<ActionResult<ReelDto>> ToggleCommentLike(Guid reelId, Guid commentId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var updated = await reelService.ToggleCommentLikeAsync(reelId, commentId, profileId, cancellationToken);
        return updated is null ? NotFound() : Ok(updated);
    }

    [Authorize]
    [HttpGet("feed")]
    public async Task<ActionResult<IReadOnlyCollection<ReelDto>>> GetFeed([FromQuery] int take = 25, [FromQuery] string mode = "for-you", CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var feedMode = ParseFeedMode(mode);
        var feed = await reelService.GetFeedAsync(profileId, take, feedMode, cancellationToken);
        return Ok(feed);
    }

    [Authorize]
    [HttpGet("by-author/{handle}")]
    public async Task<ActionResult<IReadOnlyCollection<ReelDto>>> GetByAuthor([FromRoute] string handle, [FromQuery] int take = 25, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var reels = await reelService.GetByAuthorHandleAsync(profileId, handle, take, cancellationToken);
        return Ok(reels);
    }

    [AllowAnonymous]
    [HttpGet("{reelId:guid}/public")]
    public async Task<ActionResult<ReelDto>> GetPublicById(Guid reelId, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var reel = await reelService.GetPublicByIdAsync(reelId, viewerId, cancellationToken);
        return reel is null ? NotFound() : Ok(reel);
    }

    [AllowAnonymous]
    [HttpGet("by-author/{handle}/public")]
    public async Task<ActionResult<IReadOnlyCollection<ReelDto>>> GetPublicByAuthor([FromRoute] string handle, [FromQuery] int take = 25, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var reels = await reelService.GetPublicByAuthorHandleAsync(handle, viewerId, take, cancellationToken);
        return Ok(reels);
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }

    private Guid? TryGetOptionalProfileId()
    {
        return TryGetProfileId(out var profileId) ? profileId : null;
    }

    private static FeedMode ParseFeedMode(string? mode)
    {
        return string.Equals(mode, "following", StringComparison.OrdinalIgnoreCase)
            ? FeedMode.Following
            : FeedMode.ForYou;
    }

    private async Task<string> SaveVideoAsync(Guid profileId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (!AllowedVideoExtensions.Contains(extension))
        {
            throw new ArgumentException("Allowed reel video files: .mp4, .webm, .mov, .m4v, .ogv.");
        }

        return await SaveToDatabaseAsync(profileId, file, extension, cancellationToken);
    }

    private async Task<string> SaveThumbnailAsync(Guid profileId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (!AllowedImageExtensions.Contains(extension))
        {
            throw new ArgumentException("Allowed thumbnail files: .jpg, .jpeg, .png, .webp.");
        }

        return await SaveToDatabaseAsync(profileId, file, extension, cancellationToken);
    }

    private async Task<string> SaveToDatabaseAsync(Guid profileId, IFormFile file, string extension, CancellationToken cancellationToken)
    {
        await using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, cancellationToken);

        var uploaded = new UploadedImage
        {
            Id = Guid.NewGuid(),
            UploadedByProfileId = profileId,
            ContentType = NormalizeContentType(file.ContentType, extension),
            OriginalFileName = Path.GetFileName(file.FileName),
            FileExtension = extension.ToLowerInvariant(),
            Content = memoryStream.ToArray(),
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.UploadedImages.Add(uploaded);
        await dbContext.SaveChangesAsync(cancellationToken);

        return BuildUploadedMediaUrl(uploaded.Id);
    }

    private string BuildUploadedMediaUrl(Guid id)
    {
        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : string.Empty;
        var relativePath = $"{pathBase}/api/uploads/images/{id:D}";
        return $"{Request.Scheme}://{Request.Host}{relativePath}";
    }

    private static string NormalizeContentType(string? contentType, string extension)
    {
        if (!string.IsNullOrWhiteSpace(contentType)
            && (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                || contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)))
        {
            return contentType;
        }

        return extension.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            ".mov" => "video/quicktime",
            ".m4v" => "video/x-m4v",
            ".ogv" => "video/ogg",
            _ => "image/jpeg"
        };
    }

    private static readonly HashSet<string> AllowedVideoExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp4", ".webm", ".mov", ".m4v", ".ogv"
    };

    private static readonly HashSet<string> AllowedImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp"
    };

    public sealed record CreateReelCommentBody(string Content, Guid? ParentCommentId = null);
    public sealed record UpdateReelCommentBody(string Content);
    public sealed record UpdateReelBody(string? Caption);
    public sealed record CreateReelFormRequest(string? Caption, int DurationSeconds, IFormFile? Video, IFormFile? Thumbnail);
}
