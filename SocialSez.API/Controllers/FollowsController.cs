using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;

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

    public sealed record FollowRequest(Guid FollowedId);
    public sealed record FollowStatusResponse(bool IsFollowing);

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}
