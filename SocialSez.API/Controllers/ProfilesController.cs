using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProfilesController(IProfileService profileService) : ControllerBase
{
    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult<ProfileDto>> GetMe(CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var profile = await profileService.GetByIdAsync(profileId, cancellationToken);
        return profile is null ? NotFound() : Ok(profile);
    }

    [HttpGet("{handle}")]
    public async Task<ActionResult<ProfileDto>> GetByHandle(string handle, CancellationToken cancellationToken)
    {
        var viewerId = TryGetOptionalProfileId();
        var profile = await profileService.GetByHandleAsync(handle, viewerId, cancellationToken);
        return profile is null ? NotFound() : Ok(profile);
    }

    [HttpGet("{handle}/activity")]
    public async Task<ActionResult<ProfileActivitySummaryDto>> GetActivitySummary(string handle, CancellationToken cancellationToken)
    {
        var summary = await profileService.GetActivitySummaryByHandleAsync(handle, cancellationToken);
        return summary is null ? NotFound() : Ok(summary);
    }

    [HttpGet("search")]
    public async Task<ActionResult<IReadOnlyCollection<ProfileDto>>> Search([FromQuery] string q, [FromQuery] int take = 20, CancellationToken cancellationToken = default)
    {
        var viewerId = TryGetOptionalProfileId();
        var results = await profileService.SearchAsync(q, viewerId, take, cancellationToken);
        return Ok(results);
    }

    [Authorize]
    [HttpPut("me")]
    public async Task<ActionResult<ProfileDto>> Update([FromBody] UpdateProfileRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var profile = await profileService.UpdateAsync(profileId, request, cancellationToken);
        return profile is null ? NotFound() : Ok(profile);
    }

    [Authorize]
    [HttpPut("me/privacy")]
    public async Task<ActionResult<ProfileDto>> UpdatePrivacy([FromBody] UpdateProfilePrivacyRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var profile = await profileService.UpdatePrivacyAsync(profileId, request, cancellationToken);
        return profile is null ? NotFound() : Ok(profile);
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
}
