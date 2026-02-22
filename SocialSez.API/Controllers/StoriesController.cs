using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class StoriesController(IStoryService storyService, IWebHostEnvironment environment) : ControllerBase
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
                new CreateStoryRequest(profileId, request.Caption, mediaUrl, request.ExpiresInHours),
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
    public async Task<ActionResult<IReadOnlyCollection<StoryGroupDto>>> GetFeed([FromQuery] int takeAuthors = 25, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var feed = await storyService.GetFeedAsync(profileId, takeAuthors, cancellationToken);
        return Ok(feed);
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }

    private async Task<string> SaveMediaAsync(Guid profileId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (!AllowedExtensions.Contains(extension))
        {
            throw new ArgumentException("Allowed story media files: .jpg, .jpeg, .png, .webp, .gif, .mp4, .webm, .mov, .m4v, .ogv.");
        }

        var uploadsRoot = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "uploads", "stories");
        Directory.CreateDirectory(uploadsRoot);

        var safeFileName = $"story-{profileId:N}-{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var absoluteFilePath = Path.Combine(uploadsRoot, safeFileName);

        await using (var stream = System.IO.File.Create(absoluteFilePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        return $"{Request.Scheme}://{Request.Host}/uploads/stories/{safeFileName}";
    }

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".ogv"
    };

    public sealed record CreateStoryFormRequest(string? Caption, int? ExpiresInHours, IFormFile? Media);
}
