using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CustomFeedsController(ICustomFeedService customFeedService) : ControllerBase
{
    [Authorize]
    [HttpGet("mine")]
    public async Task<ActionResult<IReadOnlyCollection<CustomFeedDto>>> GetMine(CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var feeds = await customFeedService.GetMineAsync(profileId, cancellationToken);
        return Ok(feeds);
    }

    [Authorize]
    [HttpPost]
    public async Task<ActionResult<CustomFeedDto>> Create([FromBody] CreateCustomFeedRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var feed = await customFeedService.CreateAsync(profileId, request, cancellationToken);
            return Ok(feed);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpPut("{customFeedId:guid}")]
    public async Task<ActionResult<CustomFeedDto>> Update(Guid customFeedId, [FromBody] UpdateCustomFeedRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await customFeedService.UpdateAsync(profileId, customFeedId, request, cancellationToken);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpDelete("{customFeedId:guid}")]
    public async Task<IActionResult> Delete(Guid customFeedId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var deleted = await customFeedService.DeleteAsync(profileId, customFeedId, cancellationToken);
        return deleted ? NoContent() : NotFound();
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}