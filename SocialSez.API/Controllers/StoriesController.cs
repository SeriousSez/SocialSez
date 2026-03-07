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
            var story = await storyService.CreateAsync(
                new CreateStoryRequest(profileId, request.Caption, mediaUrl),
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

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".ogv"
    };

    public sealed record CreateStoryFormRequest(string? Caption, IFormFile? Media);
}
