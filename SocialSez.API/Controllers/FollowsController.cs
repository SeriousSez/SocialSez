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
    public async Task<ActionResult> Follow([FromBody] FollowRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var followerId))
        {
            return Unauthorized();
        }

        var success = await followService.FollowAsync(followerId, request.FollowedId, cancellationToken);
        return success ? Ok() : BadRequest(new { message = "Unable to follow user." });
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
    public async Task<ActionResult<FollowStatusResponse>> GetStatus([FromQuery] Guid followedId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var followerId))
        {
            return Unauthorized();
        }

        var isFollowing = await followService.IsFollowingAsync(followerId, followedId, cancellationToken);
        return Ok(new FollowStatusResponse(isFollowing));
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
    public sealed record FollowStatusResponse(bool IsFollowing);

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}
