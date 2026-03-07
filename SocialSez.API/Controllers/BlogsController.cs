using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class BlogsController(IBlogService blogService) : ControllerBase
{
    [Authorize]
    [HttpGet("mine")]
    public async Task<ActionResult<IReadOnlyCollection<BlogDto>>> GetMine(CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var blogs = await blogService.GetMineAsync(profileId, cancellationToken);
        return Ok(blogs);
    }

    [HttpGet("discover")]
    public async Task<ActionResult<IReadOnlyCollection<BlogDto>>> Discover([FromQuery] string? q, [FromQuery] int take = 60, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var blogs = await blogService.DiscoverAsync(viewerId, q, take, cancellationToken);
        return Ok(blogs);
    }

    [Authorize]
    [HttpGet("following")]
    public async Task<ActionResult<IReadOnlyCollection<BlogDto>>> GetFollowing([FromQuery] string? q, [FromQuery] int take = 60, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var blogs = await blogService.GetFollowingAsync(profileId, q, take, cancellationToken);
        return Ok(blogs);
    }

    [HttpGet("by-author/{handle}")]
    public async Task<ActionResult<IReadOnlyCollection<BlogDto>>> GetByAuthorHandle(string handle, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var blogs = await blogService.GetByOwnerHandleAsync(handle, viewerId, cancellationToken);
        return Ok(blogs);
    }

    [HttpGet("{handle}/{blogSlug}")]
    public async Task<ActionResult<BlogDto>> GetBlogBySlug(string handle, string blogSlug, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var blog = await blogService.GetByOwnerHandleAndSlugAsync(handle, blogSlug, viewerId, cancellationToken);
        return blog is null ? NotFound() : Ok(blog);
    }

    [HttpGet("{handle}/{blogSlug}/posts")]
    public async Task<ActionResult<IReadOnlyCollection<BlogPostDto>>> GetPosts(string handle, string blogSlug, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var posts = await blogService.GetPostsAsync(handle, blogSlug, viewerId, cancellationToken);
        return Ok(posts);
    }

    [HttpGet("{handle}/{blogSlug}/posts/{postSlug}")]
    public async Task<ActionResult<BlogPostDto>> GetPost(string handle, string blogSlug, string postSlug, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var post = await blogService.GetPostBySlugAsync(handle, blogSlug, postSlug, viewerId, cancellationToken);
        return post is null ? NotFound() : Ok(post);
    }

    [Authorize]
    [HttpPost]
    public async Task<ActionResult<BlogDto>> Create([FromBody] CreateBlogBody body, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var created = await blogService.CreateAsync(profileId, new CreateBlogRequest(body.Title, body.Description, body.Slug, body.IsPublic, body.Theme), cancellationToken);
            return Ok(created);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPut("{blogId:guid}")]
    public async Task<ActionResult<BlogDto>> Update(Guid blogId, [FromBody] UpdateBlogBody body, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await blogService.UpdateAsync(blogId, profileId, new UpdateBlogRequest(body.Title, body.Description, body.Slug, body.IsPublic, body.Theme), cancellationToken);
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
    [HttpDelete("{blogId:guid}")]
    public async Task<ActionResult> Delete(Guid blogId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var deleted = await blogService.DeleteAsync(blogId, profileId, cancellationToken);
            return deleted ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("{blogId:guid}/posts")]
    public async Task<ActionResult<BlogPostDto>> CreatePost(Guid blogId, [FromBody] CreateBlogPostBody body, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var created = await blogService.CreatePostAsync(
                blogId,
                profileId,
                new CreateBlogPostRequest(body.Title, body.Content, body.Excerpt, body.CoverImageUrl, body.Tags, body.IsPublished, body.Slug),
                cancellationToken);
            return Ok(created);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPut("{blogId:guid}/posts/{postId:guid}")]
    public async Task<ActionResult<BlogPostDto>> UpdatePost(Guid blogId, Guid postId, [FromBody] UpdateBlogPostBody body, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await blogService.UpdatePostAsync(
                blogId,
                postId,
                profileId,
                new UpdateBlogPostRequest(body.Title, body.Content, body.Excerpt, body.CoverImageUrl, body.Tags, body.IsPublished, body.Slug),
                cancellationToken);
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
    [HttpDelete("{blogId:guid}/posts/{postId:guid}")]
    public async Task<ActionResult> DeletePost(Guid blogId, Guid postId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var deleted = await blogService.DeletePostAsync(blogId, postId, profileId, cancellationToken);
            return deleted ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
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

    public sealed record CreateBlogBody(string Title, string? Description, string? Slug, bool IsPublic, BlogThemeConfigDto? Theme);
    public sealed record UpdateBlogBody(string Title, string? Description, string? Slug, bool IsPublic, BlogThemeConfigDto? Theme);
    public sealed record CreateBlogPostBody(string Title, string Content, string? Excerpt, string? CoverImageUrl, IReadOnlyCollection<string>? Tags, bool IsPublished, string? Slug);
    public sealed record UpdateBlogPostBody(string Title, string Content, string? Excerpt, string? CoverImageUrl, IReadOnlyCollection<string>? Tags, bool IsPublished, string? Slug);
}
