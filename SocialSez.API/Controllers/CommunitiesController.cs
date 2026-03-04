using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CommunitiesController(ICommunityService communityService) : ControllerBase
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
            var created = await communityService.CreateAsync(profileId, new CreateCommunityRequest(request.Name, request.Description, request.ImageUrl, request.IsPrivate), cancellationToken);
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
            var updated = await communityService.UpdateAsync(communityId, profileId, new UpdateCommunityRequest(request.Name, request.Description, request.ImageUrl, request.IsPrivate), cancellationToken);
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
                new CreateCommunityPostRequest(profileId, request.Content, request.ImageUrl, request.PollQuestion, request.PollOptions),
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

    [HttpGet("{communityId:guid}/posts")]
    public async Task<ActionResult<IReadOnlyCollection<CommunityPostDto>>> GetPosts(Guid communityId, [FromQuery] string? q, [FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var posts = await communityService.GetPostsAsync(communityId, viewerId, q, take, cancellationToken);
        return Ok(posts);
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

    public sealed record CreateCommunityBody(string Name, string? Description, string? ImageUrl, bool IsPrivate);
    public sealed record UpdateCommunityBody(string Name, string? Description, string? ImageUrl, bool IsPrivate);
    public sealed record CreateCommunityPostBody(string? Content, string? ImageUrl, string? PollQuestion, IReadOnlyCollection<string>? PollOptions);
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