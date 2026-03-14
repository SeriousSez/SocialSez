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
public class StoriesController(IStoryService storyService, SocialSezContext dbContext) : ControllerBase
{
    [Authorize]
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(512 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 512 * 1024 * 1024)]
    public async Task<ActionResult<StoryDto>> Create([FromForm] CreateStoryFormRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            if (request.Media is null || request.Media.Length <= 0)
            {
                return BadRequest(new { message = "Story media is required." });
            }

            var mediaUrl = await SaveMediaAsync(profileId, request.Media, cancellationToken);
            var thumbnailUrl = request.Thumbnail is { Length: > 0 }
                ? await SaveThumbnailAsync(profileId, request.Thumbnail, cancellationToken)
                : null;
            var story = await storyService.CreateAsync(
                new CreateStoryRequest(
                    profileId,
                    request.Caption,
                    mediaUrl,
                    thumbnailUrl,
                    request.IsSensitive,
                    request.SaveAsDraft,
                    request.ScheduledPublishAtUtc),
                cancellationToken);

            return Ok(story);
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
    [HttpDelete("{storyId:guid}")]
    public async Task<IActionResult> Delete(Guid storyId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var deleted = await storyService.DeleteAsync(storyId, profileId, cancellationToken);
            return deleted ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("{storyId:guid}/view")]
    public async Task<IActionResult> MarkViewed(Guid storyId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var marked = await storyService.MarkViewedAsync(storyId, profileId, cancellationToken);
        return marked ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPut("progress/{authorId:guid}")]
    public async Task<ActionResult<StoryPlaybackProgressDto>> UpsertPlaybackProgress(Guid authorId, [FromBody] UpsertStoryPlaybackProgressRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var updated = await storyService.UpsertPlaybackProgressAsync(profileId, authorId, request, cancellationToken);
        return updated is null ? NotFound() : Ok(updated);
    }

    [Authorize]
    [HttpGet("progress/{authorId:guid}")]
    public async Task<ActionResult<StoryPlaybackProgressDto>> GetPlaybackProgress(Guid authorId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var progress = await storyService.GetPlaybackProgressAsync(profileId, authorId, cancellationToken);
        return progress is null ? NotFound() : Ok(progress);
    }

    [Authorize]
    [HttpGet("drafts/mine")]
    public async Task<ActionResult<IReadOnlyCollection<StoryDto>>> GetMyDrafts([FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var drafts = await storyService.GetDraftsAsync(profileId, take, cancellationToken);
        return Ok(drafts);
    }

    [Authorize]
    [HttpGet("feed")]
    public async Task<ActionResult<IReadOnlyCollection<StoryGroupDto>>> GetFeed([FromQuery] int takeAuthors = 25, [FromQuery] string mode = "for-you", CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var feedMode = ParseFeedMode(mode);
        var feed = await storyService.GetFeedAsync(profileId, takeAuthors, feedMode, cancellationToken);
        return Ok(feed);
    }

    [Authorize]
    [HttpGet("mine")]
    public async Task<ActionResult<IReadOnlyCollection<StoryDto>>> GetMine([FromQuery] bool includeExpired = true, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var stories = await storyService.GetByAuthorAsync(profileId, profileId, includeExpired, take, cancellationToken);
            return Ok(stories);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("collections")]
    public async Task<ActionResult<StoryCollectionDto>> CreateCollection([FromBody] CreateStoryCollectionRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var collection = await storyService.CreateCollectionAsync(profileId, request.Name, cancellationToken);
            return Ok(collection);
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
    [HttpDelete("collections/{collectionId:guid}")]
    public async Task<IActionResult> DeleteCollection(Guid collectionId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            await storyService.DeleteCollectionAsync(profileId, collectionId, cancellationToken);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPost("collections/{collectionId:guid}/stories/{storyId:guid}")]
    public async Task<ActionResult<StoryCollectionDto>> AddStoryToCollection(Guid collectionId, Guid storyId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var collection = await storyService.AddStoryToCollectionAsync(profileId, collectionId, storyId, cancellationToken);
            return Ok(collection);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpDelete("collections/{collectionId:guid}/stories/{storyId:guid}")]
    public async Task<ActionResult<StoryCollectionDto>> RemoveStoryFromCollection(Guid collectionId, Guid storyId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var collection = await storyService.RemoveStoryFromCollectionAsync(profileId, collectionId, storyId, cancellationToken);
            return Ok(collection);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpGet("collections/by-author/{handle}/public")]
    public async Task<ActionResult<IReadOnlyCollection<StoryCollectionDto>>> GetCollectionsByAuthor([FromRoute] string handle, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var collections = await storyService.GetCollectionsByAuthorHandleAsync(handle, viewerId, cancellationToken);
        return Ok(collections);
    }

    [AllowAnonymous]
    [HttpGet("{storyId:guid}/public")]
    public async Task<ActionResult<StoryDto>> GetPublicById(Guid storyId, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var story = await storyService.GetPublicByIdAsync(storyId, viewerId, cancellationToken);
        return story is null ? NotFound() : Ok(story);
    }

    [AllowAnonymous]
    [HttpGet("by-author/{handle}/public")]
    public async Task<ActionResult<StoryGroupDto>> GetPublicByAuthor([FromRoute] string handle, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var group = await storyService.GetPublicByAuthorHandleAsync(handle, viewerId, cancellationToken);
        return group is null ? NotFound() : Ok(group);
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

    private async Task<string> SaveMediaAsync(Guid profileId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (!AllowedExtensions.Contains(extension))
        {
            throw new ArgumentException("Allowed story media files: .jpg, .jpeg, .png, .webp, .gif, .mp4, .webm, .mov, .m4v, .ogv.");
        }

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

    private async Task<string> SaveThumbnailAsync(Guid profileId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (!AllowedThumbnailExtensions.Contains(extension))
        {
            throw new ArgumentException("Allowed story thumbnail files: .jpg, .jpeg, .png, .webp.");
        }

        await using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, cancellationToken);

        var uploaded = new UploadedImage
        {
            Id = Guid.NewGuid(),
            UploadedByProfileId = profileId,
            ContentType = NormalizeThumbnailContentType(file.ContentType, extension),
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
            ".gif" => "image/gif",
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            ".mov" => "video/quicktime",
            ".m4v" => "video/x-m4v",
            ".ogv" => "video/ogg",
            _ => "image/jpeg"
        };
    }

    private static string NormalizeThumbnailContentType(string? contentType, string extension)
    {
        if (!string.IsNullOrWhiteSpace(contentType)
            && contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return contentType;
        }

        return extension.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => "image/jpeg"
        };
    }

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".ogv"
    };

    private static readonly HashSet<string> AllowedThumbnailExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp"
    };

    public sealed record CreateStoryFormRequest(
        string? Caption,
        IFormFile? Media,
        IFormFile? Thumbnail,
        bool IsSensitive = false,
        bool SaveAsDraft = false,
        DateTime? ScheduledPublishAtUtc = null);
}
