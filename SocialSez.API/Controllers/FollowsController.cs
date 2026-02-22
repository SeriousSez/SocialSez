using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FollowsController(IFollowService followService) : ControllerBase
{
    [Authorize]
    [HttpPost]
    public async Task<ActionResult<FollowActionResultDto>> Follow([FromBody] FollowRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var followerId))
        {
            return Unauthorized();
        }

        var result = await followService.FollowAsync(followerId, request.FollowedId, cancellationToken);
        return string.Equals(result.Status, FollowActionStatuses.Invalid, StringComparison.Ordinal)
            ? BadRequest(new { message = "Unable to follow user." })
            : Ok(result);
    }

    [Authorize]
    [HttpDelete]
    public async Task<ActionResult> Unfollow([FromQuery] Guid followedId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var followerId))
        {
            return Unauthorized();
        }

        var success = await followService.UnfollowAsync(followerId, followedId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpGet("status")]
    public async Task<ActionResult<FollowStatusDto>> GetStatus([FromQuery] Guid followedId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var followerId))
        {
            return Unauthorized();
        }

        var status = await followService.GetStatusAsync(followerId, followedId, cancellationToken);
        return Ok(status);
    }

    [Authorize]
    [HttpGet("requests/incoming")]
    public async Task<ActionResult<IReadOnlyCollection<FollowRequestDto>>> GetIncomingRequests([FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var requests = await followService.GetIncomingRequestsAsync(profileId, take, cancellationToken);
        return Ok(requests);
    }

    [Authorize]
    [HttpPost("requests/{followerId:guid}/approve")]
    public async Task<ActionResult> ApproveRequest(Guid followerId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await followService.ApproveRequestAsync(profileId, followerId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPost("requests/{followerId:guid}/decline")]
    public async Task<ActionResult> DeclineRequest(Guid followerId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await followService.DeclineRequestAsync(profileId, followerId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpGet("following")]
    public async Task<ActionResult<IReadOnlyCollection<ProfileDto>>> GetFollowing([FromQuery] int take = 100, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var followerId))
        {
            return Unauthorized();
        }

        var profiles = await followService.GetFollowingAsync(followerId, take, cancellationToken);
        return Ok(profiles);
    }

    [Authorize]
    [HttpGet("suggestions")]
    public async Task<ActionResult<FollowSuggestionsDto>> GetSuggestions([FromQuery] int takePerGroup = 10, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var followerId))
        {
            return Unauthorized();
        }

        var suggestions = await followService.GetSuggestionsAsync(followerId, takePerGroup, cancellationToken);
        return Ok(suggestions);
    }

    public sealed record FollowRequest(Guid FollowedId);

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}
