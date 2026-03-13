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
public class PostsController(IPostService postService, SocialSezContext dbContext) : ControllerBase
{
    [Authorize]
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(512 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 512 * 1024 * 1024)]
    public async Task<ActionResult<PostDto>> Create([FromForm] CreatePostFormRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var postMediaUrls = new List<string>();

            if (request.Images is not null)
            {
                foreach (var image in request.Images.Where(file => file is not null && file.Length > 0))
                {
                    var mediaUrl = await SaveMediaAsync(profileId, image, cancellationToken);
                    postMediaUrls.Add(mediaUrl);
                }
            }

            if (request.Image is not null && request.Image.Length > 0)
            {
                var mediaUrl = await SaveMediaAsync(profileId, request.Image, cancellationToken);
                postMediaUrls.Add(mediaUrl);
            }

            var post = await postService.CreateAsync(new CreatePostRequest(profileId, request.Content, postMediaUrls, request.IsSensitive), cancellationToken);
            return Ok(post);
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
    [HttpPut("{postId:guid}")]
    public async Task<ActionResult<PostDto>> Update(Guid postId, [FromBody] UpdatePostRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await postService.UpdateAsync(postId, profileId, request, cancellationToken);
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
    [HttpDelete("{postId:guid}")]
    public async Task<IActionResult> Delete(Guid postId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var deleted = await postService.DeleteAsync(postId, profileId, cancellationToken);
            return deleted ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("{postId:guid}/comments")]
    public async Task<ActionResult<PostDto>> AddComment(Guid postId, [FromBody] CreateCommentBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var comment = await postService.AddCommentAsync(postId, new CreateCommentRequest(profileId, request.Content, request.ParentCommentId), cancellationToken);
            return comment is null ? NotFound() : Ok(comment);
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
    [HttpPut("{postId:guid}/comments/{commentId:guid}")]
    public async Task<ActionResult<PostDto>> UpdateComment(Guid postId, Guid commentId, [FromBody] UpdateCommentBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await postService.UpdateCommentAsync(postId, commentId, profileId, new UpdateCommentRequest(request.Content), cancellationToken);
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
    [HttpDelete("{postId:guid}/comments/{commentId:guid}")]
    public async Task<ActionResult<PostDto>> DeleteComment(Guid postId, Guid commentId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await postService.DeleteCommentAsync(postId, commentId, profileId, cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("{postId:guid}/comments/{commentId:guid}/reaction")]
    public async Task<ActionResult<PostDto>> SetCommentReaction(Guid postId, Guid commentId, [FromBody] SetReactionRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await postService.SetCommentReactionAsync(postId, commentId, profileId, request, cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpDelete("{postId:guid}/comments/{commentId:guid}/reaction")]
    public async Task<ActionResult<PostDto>> ClearCommentReaction(Guid postId, Guid commentId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var updated = await postService.ClearCommentReactionAsync(postId, commentId, profileId, cancellationToken);
        return updated is null ? NotFound() : Ok(updated);
    }

    [Authorize]
    [HttpPost("{postId:guid}/like")]
    public async Task<ActionResult<PostDto>> ToggleLike(Guid postId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var updated = await postService.ToggleLikeAsync(postId, profileId, cancellationToken);
        return updated is null ? NotFound() : Ok(updated);
    }

    [Authorize]
    [HttpPost("{postId:guid}/reaction")]
    public async Task<ActionResult<PostDto>> SetReaction(Guid postId, [FromBody] SetReactionRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await postService.SetReactionAsync(postId, profileId, request, cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpDelete("{postId:guid}/reaction")]
    public async Task<ActionResult<PostDto>> ClearReaction(Guid postId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var updated = await postService.ClearReactionAsync(postId, profileId, cancellationToken);
        return updated is null ? NotFound() : Ok(updated);
    }

    [Authorize]
    [HttpGet("feed")]
    public async Task<ActionResult<IReadOnlyCollection<PostDto>>> GetFeed([FromQuery] int take = 25, [FromQuery] string mode = "for-you", CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var feedMode = ParseFeedMode(mode);
        var feed = await postService.GetFeedAsync(profileId, take, feedMode, cancellationToken);
        return Ok(feed);
    }

    [HttpGet("search")]
    public async Task<ActionResult<IReadOnlyCollection<PostDto>>> SearchPosts([FromQuery] string q, [FromQuery] int take = 25, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var posts = await postService.SearchPostsAsync(viewerId, q, take, cancellationToken);
        return Ok(posts);
    }

    [HttpGet("hashtags/trending")]
    public async Task<ActionResult<IReadOnlyCollection<HashtagSearchResultDto>>> GetTrendingHashtags([FromQuery] int take = 10, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var hashtags = await postService.GetTrendingHashtagsAsync(take, viewerId, cancellationToken);
        return Ok(hashtags);
    }

    [HttpGet("hashtags/search")]
    public async Task<ActionResult<IReadOnlyCollection<HashtagSearchResultDto>>> SearchHashtags([FromQuery] string q, [FromQuery] int take = 20, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var hashtags = await postService.SearchHashtagsAsync(q, take, viewerId, cancellationToken);
        return Ok(hashtags);
    }

    [Authorize]
    [HttpGet("hashtags/following")]
    public async Task<ActionResult<IReadOnlyCollection<FollowedHashtagDto>>> GetFollowedHashtags([FromQuery] int take = 20, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var hashtags = await postService.GetFollowedHashtagsAsync(profileId, take, cancellationToken);
        return Ok(hashtags);
    }

    [Authorize]
    [HttpPost("hashtags/{hashtag}/follow")]
    public async Task<ActionResult<FollowedHashtagDto>> FollowHashtag(string hashtag, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var followed = await postService.FollowHashtagAsync(profileId, hashtag, cancellationToken);
        return followed is null ? BadRequest(new { message = "Hashtag is required." }) : Ok(followed);
    }

    [Authorize]
    [HttpDelete("hashtags/{hashtag}/follow")]
    public async Task<IActionResult> UnfollowHashtag(string hashtag, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var unfollowed = await postService.UnfollowHashtagAsync(profileId, hashtag, cancellationToken);
        return unfollowed ? NoContent() : NotFound();
    }

    [AllowAnonymous]
    [HttpGet("hashtags/{hashtag}/content")]
    public async Task<ActionResult<HashtagContentDto>> GetHashtagContent(string hashtag, [FromQuery] int takePerType = 25, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();

        try
        {
            var content = await postService.GetHashtagContentAsync(viewerId, hashtag, takePerType, cancellationToken);
            return Ok(content);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpGet("hashtags/{hashtag}")]
    public async Task<ActionResult<IReadOnlyCollection<PostDto>>> GetByHashtag(string hashtag, [FromQuery] int take = 25, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();

        try
        {
            var posts = await postService.GetByHashtagAsync(viewerId, hashtag, take, cancellationToken);
            return Ok(posts);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpGet("by-author/{handle}")]
    public async Task<ActionResult<IReadOnlyCollection<PostDto>>> GetByAuthor(string handle, [FromQuery] int take = 25, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var posts = await postService.GetByAuthorHandleAsync(profileId, handle, take, cancellationToken);
        return Ok(posts);
    }

    [AllowAnonymous]
    [HttpGet("{postId:guid}/public")]
    public async Task<ActionResult<PostDto>> GetPublicById(Guid postId, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var post = await postService.GetPublicByIdAsync(postId, viewerId, cancellationToken);
        return post is null ? NotFound() : Ok(post);
    }

    [AllowAnonymous]
    [HttpGet("by-author/{handle}/public")]
    public async Task<ActionResult<IReadOnlyCollection<PostDto>>> GetPublicByAuthor(string handle, [FromQuery] int take = 25, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var posts = await postService.GetPublicByAuthorHandleAsync(handle, viewerId, take, cancellationToken);
        return Ok(posts);
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
            throw new ArgumentException("Allowed media files: .jpg, .jpeg, .png, .webp, .gif, .mp4, .webm, .mov, .m4v, .ogv.");
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

    public sealed record CreatePostFormRequest(string? Content, IReadOnlyCollection<IFormFile>? Images, IFormFile? Image, bool IsSensitive = false);
    public sealed record CreateCommentBody(string Content, Guid? ParentCommentId = null);
    public sealed record UpdateCommentBody(string Content);
}
