using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CommunitiesController(ICommunityService communityService, ILogger<CommunitiesController> logger) : ControllerBase
{
    [Authorize]
    [HttpPost]
    public async Task<ActionResult<CommunityDto>> Create([FromBody] CreateCommunityBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var created = await communityService.CreateAsync(profileId, new CreateCommunityRequest(request.Name, request.Description, request.Rules, request.ImageUrl, request.IsPrivate), cancellationToken);
            return Ok(created);
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
    [HttpPut("{communityId:guid}")]
    public async Task<ActionResult<CommunityDto>> Update(Guid communityId, [FromBody] UpdateCommunityBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.UpdateAsync(communityId, profileId, new UpdateCommunityRequest(request.Name, request.Description, request.Rules, request.ImageUrl, request.IsPrivate), cancellationToken);
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
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex)
        {
            var message = ex.InnerException?.Message ?? ex.Message;
            logger.LogWarning(ex, "Failed to update community {CommunityId} due to database update error.", communityId);
            return BadRequest(new { message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unexpected error while updating community {CommunityId}.", communityId);
            return BadRequest(new { message = "Unable to update post right now. Please try again." });
        }
    }

    [Authorize]
    [HttpGet("mine")]
    public async Task<ActionResult<IReadOnlyCollection<CommunityDto>>> GetMine([FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var communities = await communityService.GetMineAsync(profileId, take, cancellationToken);
        return Ok(communities);
    }

    [HttpGet("discover")]
    public async Task<ActionResult<IReadOnlyCollection<CommunityDto>>> Discover([FromQuery] string? q, [FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var communities = await communityService.DiscoverAsync(viewerId, q, take, cancellationToken);
        return Ok(communities);
    }

    [HttpGet("{communityId:guid}")]
    public async Task<ActionResult<CommunityDto>> GetById(Guid communityId, [FromQuery] int members = 20, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var community = await communityService.GetByIdAsync(communityId, viewerId, members, cancellationToken);
        return community is null ? NotFound() : Ok(community);
    }

    [HttpGet("slug/{slug}")]
    public async Task<ActionResult<CommunityDto>> GetBySlug(string slug, [FromQuery] int members = 20, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var community = await communityService.GetBySlugAsync(slug, viewerId, members, cancellationToken);
        return community is null ? NotFound() : Ok(community);
    }

    [Authorize]
    [HttpPut("{communityId:guid}/members/{memberProfileId:guid}/role")]
    public async Task<ActionResult<CommunityDto>> UpdateMemberRole(Guid communityId, Guid memberProfileId, [FromBody] UpdateCommunityMemberRoleBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.UpdateMemberRoleAsync(communityId, profileId, memberProfileId, new UpdateCommunityMemberRoleRequest(request.Role), cancellationToken);
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
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPost("{communityId:guid}/members/{memberProfileId:guid}/timeout")]
    public async Task<ActionResult<CommunityDto>> TimeoutMember(Guid communityId, Guid memberProfileId, [FromBody] TimeoutCommunityMemberBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.TimeoutMemberAsync(communityId, profileId, memberProfileId, new TimeoutCommunityMemberRequest(request.DurationDays), cancellationToken);
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
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPost("{communityId:guid}/posts")]
    public async Task<ActionResult<CommunityPostDto>> CreatePost(Guid communityId, [FromBody] CreateCommunityPostBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var created = await communityService.CreatePostAsync(
                communityId,
                new CreateCommunityPostRequest(profileId, request.Title, request.LinkUrl, request.Content, request.ImageUrls, request.PollQuestion, request.PollOptions),
                cancellationToken);

            return created is null ? NotFound() : Ok(created);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
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
    [HttpPost("{communityId:guid}/posts/{postId:guid}/vote")]
    public async Task<ActionResult<CommunityPostDto>> VotePost(Guid communityId, Guid postId, [FromBody] VoteCommunityPostBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.VotePostAsync(communityId, postId, new VoteCommunityPostRequest(profileId, request.VoteType), cancellationToken);
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
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpDelete("{communityId:guid}/posts/{postId:guid}")]
    public async Task<ActionResult> DeletePost(Guid communityId, Guid postId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var deleted = await communityService.DeletePostAsync(communityId, postId, profileId, cancellationToken);
            return deleted ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPut("{communityId:guid}/posts/{postId:guid}")]
    public async Task<ActionResult<CommunityPostDto>> UpdatePost(Guid communityId, Guid postId, [FromBody] UpdateCommunityPostBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.UpdatePostAsync(
                communityId,
                postId,
                new UpdateCommunityPostRequest(profileId, request.Title, request.LinkUrl, request.Content, request.ImageUrls, request.PollQuestion, request.PollOptions, request.ClearPoll),
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
        catch (InvalidOperationException ex)
        {
            logger.LogWarning(ex, "Invalid operation while updating community post {PostId} in community {CommunityId}.", postId, communityId);
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex)
        {
            var message = ex.InnerException?.Message ?? ex.Message;
            logger.LogWarning(ex, "Database update error while updating community post {PostId} in community {CommunityId}.", postId, communityId);
            return BadRequest(new { message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unexpected error while updating community post {PostId} in community {CommunityId}.", postId, communityId);
            return BadRequest(new { message = "Unable to update post right now. Please try again." });
        }
    }

    [Authorize]
    [HttpPost("{communityId:guid}/posts/{postId:guid}/comments")]
    public async Task<ActionResult<CommunityPostDto>> AddComment(Guid communityId, Guid postId, [FromBody] CreateCommunityPostCommentBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.AddCommentAsync(communityId, postId, new CreateCommunityPostCommentRequest(profileId, request.Content, request.ParentCommentId), cancellationToken);
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
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPut("{communityId:guid}/posts/{postId:guid}/comments/{commentId:guid}")]
    public async Task<ActionResult<CommunityPostDto>> UpdateComment(Guid communityId, Guid postId, Guid commentId, [FromBody] UpdateCommunityPostCommentBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.UpdateCommentAsync(communityId, postId, commentId, new UpdateCommunityPostCommentRequest(profileId, request.Content), cancellationToken);
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
    [HttpDelete("{communityId:guid}/posts/{postId:guid}/comments/{commentId:guid}")]
    public async Task<ActionResult<CommunityPostDto>> DeleteComment(Guid communityId, Guid postId, Guid commentId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.DeleteCommentAsync(communityId, postId, commentId, profileId, cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [HttpGet("{communityId:guid}/posts")]
    public async Task<ActionResult<IReadOnlyCollection<CommunityPostDto>>> GetPosts(Guid communityId, [FromQuery] string? q, [FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var posts = await communityService.GetPostsAsync(communityId, viewerId, q, take, cancellationToken);
        return Ok(posts);
    }

    [HttpGet("posts/{postId:guid}/shared")]
    public async Task<ActionResult<CommunityPostDto>> GetSharedPostById(Guid postId, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var post = await communityService.GetPostByIdAsync(postId, viewerId, cancellationToken);
        return post is null ? NotFound() : Ok(post);
    }

    [Authorize]
    [HttpPost("{communityId:guid}/posts/{postId:guid}/save")]
    public async Task<ActionResult<CommunityPostDto>> SavePost(Guid communityId, Guid postId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var saved = await communityService.SavePostAsync(communityId, postId, profileId, cancellationToken);
            return saved is null ? NotFound() : Ok(saved);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpDelete("{communityId:guid}/posts/{postId:guid}/save")]
    public async Task<ActionResult> UnsavePost(Guid communityId, Guid postId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var removed = await communityService.UnsavePostAsync(communityId, postId, profileId, cancellationToken);
        return removed ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPost("{communityId:guid}/polls/{pollId:guid}/vote")]
    public async Task<ActionResult<CommunityPollDto>> VotePoll(Guid communityId, Guid pollId, [FromBody] VoteCommunityPollBody request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await communityService.VotePollAsync(communityId, pollId, new VoteCommunityPollRequest(profileId, request.OptionId), cancellationToken);
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
    [HttpPost("{communityId:guid}/join")]
    public async Task<ActionResult<CommunityDto>> Join(Guid communityId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var joined = await communityService.JoinAsync(communityId, profileId, cancellationToken);
            return joined is null ? NotFound() : Ok(joined);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPost("{communityId:guid}/leave")]
    public async Task<ActionResult> Leave(Guid communityId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var left = await communityService.LeaveAsync(communityId, profileId, cancellationToken);
            return left ? NoContent() : NotFound();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    public sealed record CreateCommunityBody(string Name, string? Description, IReadOnlyCollection<CommunityRuleDto>? Rules, string? ImageUrl, bool IsPrivate);
    public sealed record UpdateCommunityBody(string Name, string? Description, IReadOnlyCollection<CommunityRuleDto>? Rules, string? ImageUrl, bool IsPrivate);
    public sealed record UpdateCommunityMemberRoleBody(string Role);
    public sealed record TimeoutCommunityMemberBody(int DurationDays);
    public sealed record CreateCommunityPostBody(string? Title, string? LinkUrl, string? Content, IReadOnlyCollection<string>? ImageUrls, string? PollQuestion, IReadOnlyCollection<string>? PollOptions);
    public sealed record UpdateCommunityPostBody(string? Title, string? LinkUrl, string? Content, IReadOnlyCollection<string>? ImageUrls, string? PollQuestion, IReadOnlyCollection<string>? PollOptions, bool ClearPoll);
    public sealed record CreateCommunityPostCommentBody(string Content, Guid? ParentCommentId = null);
    public sealed record UpdateCommunityPostCommentBody(string Content);
    public sealed record VoteCommunityPostBody(string? VoteType);
    public sealed record VoteCommunityPollBody(Guid OptionId);

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }

    private Guid? TryGetOptionalProfileId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out var profileId) ? profileId : null;
    }
}