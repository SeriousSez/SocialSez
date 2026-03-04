using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SafetyController(ISafetyService safetyService) : ControllerBase
{
    [Authorize]
    [HttpGet("status")]
    public async Task<ActionResult<SafetyStatusDto>> GetStatus([FromQuery] Guid targetProfileId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var status = await safetyService.GetStatusAsync(profileId, targetProfileId, cancellationToken);
        return Ok(status);
    }

    [Authorize]
    [HttpGet("blocked")]
    public async Task<ActionResult<IReadOnlyCollection<ProfileDto>>> GetBlocked([FromQuery] int take = 100, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var profiles = await safetyService.GetBlockedProfilesAsync(profileId, take, cancellationToken);
        return Ok(profiles);
    }

    [Authorize]
    [HttpPost("block")]
    public async Task<ActionResult> Block([FromBody] TargetProfileRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.BlockAsync(profileId, request.TargetProfileId, cancellationToken);
        return success ? NoContent() : BadRequest(new { message = "Could not block profile." });
    }

    [Authorize]
    [HttpDelete("block")]
    public async Task<ActionResult> Unblock([FromQuery] Guid targetProfileId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.UnblockAsync(profileId, targetProfileId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPost("mute")]
    public async Task<ActionResult> Mute([FromBody] TargetProfileRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.MuteAsync(profileId, request.TargetProfileId, cancellationToken);
        return success ? NoContent() : BadRequest(new { message = "Could not mute profile." });
    }

    [Authorize]
    [HttpDelete("mute")]
    public async Task<ActionResult> Unmute([FromQuery] Guid targetProfileId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.UnmuteAsync(profileId, targetProfileId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPost("report")]
    public async Task<ActionResult> Report([FromBody] ReportRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.ReportAsync(
            profileId,
            request.TargetProfileId,
            new ReportProfileRequestDto(request.Reason, request.Details),
            cancellationToken);

        return success ? NoContent() : BadRequest(new { message = "Could not submit report." });
    }

    [Authorize]
    [HttpPost("report/post")]
    public async Task<ActionResult> ReportPost([FromBody] ReportPostRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.ReportPostAsync(
            profileId,
            request.TargetPostId,
            new ReportContentRequestDto(request.Reason, request.Details),
            cancellationToken);

        return success ? NoContent() : BadRequest(new { message = "Could not submit report." });
    }

    [Authorize]
    [HttpPost("report/reel")]
    public async Task<ActionResult> ReportReel([FromBody] ReportReelRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.ReportReelAsync(
            profileId,
            request.TargetReelId,
            new ReportContentRequestDto(request.Reason, request.Details),
            cancellationToken);

        return success ? NoContent() : BadRequest(new { message = "Could not submit report." });
    }

    [Authorize]
    [HttpPost("report/story")]
    public async Task<ActionResult> ReportStory([FromBody] ReportStoryRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.ReportStoryAsync(
            profileId,
            request.TargetStoryId,
            new ReportContentRequestDto(request.Reason, request.Details),
            cancellationToken);

        return success ? NoContent() : BadRequest(new { message = "Could not submit report." });
    }

    [Authorize]
    [HttpPost("report/comment")]
    public async Task<ActionResult> ReportComment([FromBody] ReportCommentRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.ReportCommentAsync(
            profileId,
            request.TargetCommentId,
            new ReportContentRequestDto(request.Reason, request.Details),
            cancellationToken);

        return success ? NoContent() : BadRequest(new { message = "Could not submit report." });
    }

    [Authorize]
    [HttpPost("report/reel-comment")]
    public async Task<ActionResult> ReportReelComment([FromBody] ReportReelCommentRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.ReportReelCommentAsync(
            profileId,
            request.TargetReelCommentId,
            new ReportContentRequestDto(request.Reason, request.Details),
            cancellationToken);

        return success ? NoContent() : BadRequest(new { message = "Could not submit report." });
    }

    [Authorize]
    [HttpPost("report/message")]
    public async Task<ActionResult> ReportMessage([FromBody] ReportMessageRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await safetyService.ReportMessageAsync(
            profileId,
            request.TargetMessageId,
            new ReportContentRequestDto(request.Reason, request.Details),
            cancellationToken);

        return success ? NoContent() : BadRequest(new { message = "Could not submit report." });
    }

    public sealed record TargetProfileRequest(Guid TargetProfileId);

    public sealed record ReportRequest(Guid TargetProfileId, string Reason, string? Details);

    public sealed record ReportPostRequest(Guid TargetPostId, string Reason, string? Details);

    public sealed record ReportReelRequest(Guid TargetReelId, string Reason, string? Details);

    public sealed record ReportStoryRequest(Guid TargetStoryId, string Reason, string? Details);

    public sealed record ReportCommentRequest(Guid TargetCommentId, string Reason, string? Details);

    public sealed record ReportReelCommentRequest(Guid TargetReelCommentId, string Reason, string? Details);

    public sealed record ReportMessageRequest(Guid TargetMessageId, string Reason, string? Details);

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}
