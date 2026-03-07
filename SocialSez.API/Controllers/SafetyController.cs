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
    [HttpGet("reputation")]
    public async Task<ActionResult<ReputationScoreDto>> GetReputation([FromQuery] Guid profileId, CancellationToken cancellationToken)
    {
        var reputation = await safetyService.GetReputationScoreAsync(profileId, cancellationToken);
        return reputation is null ? NotFound() : Ok(reputation);
    }

    [Authorize]
    [HttpPost("scan")]
    public async Task<ActionResult<ContentModerationScanResultDto>> Scan([FromBody] ScanRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var result = await safetyService.ScanContentAsync(
            profileId,
            new ContentModerationScanRequestDto(request.Content, request.LinkUrl, request.CommunityId, request.SourceEntityId, request.SourceType),
            cancellationToken);

        return Ok(result);
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

    [Authorize]
    [HttpGet("moderation-queue")]
    public async Task<ActionResult<IReadOnlyCollection<ModerationQueueItemDto>>> GetModerationQueue(
        [FromQuery] Guid? communityId,
        [FromQuery] string? status = "Open",
        [FromQuery] int take = 100,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var items = await safetyService.GetModerationQueueAsync(profileId, communityId, status, take, cancellationToken);
            return Ok(items);
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
    [HttpPost("moderation-queue/{queueItemId:guid}/resolve")]
    public async Task<ActionResult<ModerationQueueItemDto>> ResolveModerationQueueItem(Guid queueItemId, [FromBody] ResolveModerationQueueItemRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var resolved = await safetyService.ResolveModerationQueueItemAsync(
                queueItemId,
                profileId,
                new ResolveModerationQueueItemRequestDto(request.Resolution, request.ResolutionNote),
                cancellationToken);

            return resolved is null ? NotFound() : Ok(resolved);
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
    [HttpGet("community/{communityId:guid}/settings")]
    public async Task<ActionResult<CommunityModerationSettingsDto>> GetCommunitySettings(Guid communityId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var settings = await safetyService.GetCommunityModerationSettingsAsync(communityId, profileId, cancellationToken);
            return settings is null ? NotFound() : Ok(settings);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPut("community/{communityId:guid}/settings")]
    public async Task<ActionResult<CommunityModerationSettingsDto>> UpdateCommunitySettings(Guid communityId, [FromBody] UpdateCommunityModerationSettingsRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var updated = await safetyService.UpdateCommunityModerationSettingsAsync(
                communityId,
                profileId,
                new UpdateCommunityModerationSettingsRequestDto(
                    request.RulePreset,
                    request.AutoModerationEnabled,
                    request.SpamThreshold,
                    request.LinkRiskThreshold,
                    request.KeywordFilters),
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
    [HttpGet("community/{communityId:guid}/shadow-mutes")]
    public async Task<ActionResult<IReadOnlyCollection<CommunityShadowMuteDto>>> GetCommunityShadowMutes(Guid communityId, [FromQuery] int take = 100, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var mutes = await safetyService.GetCommunityShadowMutesAsync(communityId, profileId, take, cancellationToken);
            return Ok(mutes);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("community/{communityId:guid}/shadow-mutes")]
    public async Task<ActionResult<CommunityShadowMuteDto>> AddCommunityShadowMute(Guid communityId, [FromBody] CreateCommunityShadowMuteRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var mute = await safetyService.AddCommunityShadowMuteAsync(
                communityId,
                profileId,
                new CreateCommunityShadowMuteRequestDto(request.TargetProfileId, request.Reason, request.ExpiresAtUtc),
                cancellationToken);

            return mute is null ? NotFound() : Ok(mute);
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
    [HttpDelete("community/{communityId:guid}/shadow-mutes")]
    public async Task<ActionResult> RemoveCommunityShadowMute(Guid communityId, [FromQuery] Guid targetProfileId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var removed = await safetyService.RemoveCommunityShadowMuteAsync(communityId, profileId, targetProfileId, cancellationToken);
            return removed ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpPost("community/{communityId:guid}/ban-appeals")]
    public async Task<ActionResult<CommunityBanAppealDto>> SubmitCommunityBanAppeal(Guid communityId, [FromBody] CreateCommunityBanAppealRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var appeal = await safetyService.SubmitCommunityBanAppealAsync(communityId, profileId, new CreateCommunityBanAppealRequestDto(request.Reason), cancellationToken);
            return appeal is null ? NotFound() : Ok(appeal);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [Authorize]
    [HttpGet("community/{communityId:guid}/ban-appeals")]
    public async Task<ActionResult<IReadOnlyCollection<CommunityBanAppealDto>>> GetCommunityBanAppeals(Guid communityId, [FromQuery] string? status = null, [FromQuery] int take = 100, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var appeals = await safetyService.GetCommunityBanAppealsAsync(communityId, profileId, status, take, cancellationToken);
            return Ok(appeals);
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
    [HttpPost("community/{communityId:guid}/ban-appeals/{appealId:guid}/resolve")]
    public async Task<ActionResult<CommunityBanAppealDto>> ResolveCommunityBanAppeal(Guid communityId, Guid appealId, [FromBody] ResolveCommunityBanAppealRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var resolved = await safetyService.ResolveCommunityBanAppealAsync(
                communityId,
                profileId,
                appealId,
                new ResolveCommunityBanAppealRequestDto(request.Approved, request.ResolutionNote),
                cancellationToken);

            return resolved is null ? NotFound() : Ok(resolved);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    public sealed record TargetProfileRequest(Guid TargetProfileId);

    public sealed record ReportRequest(Guid TargetProfileId, string Reason, string? Details);

    public sealed record ReportPostRequest(Guid TargetPostId, string Reason, string? Details);

    public sealed record ReportReelRequest(Guid TargetReelId, string Reason, string? Details);

    public sealed record ReportStoryRequest(Guid TargetStoryId, string Reason, string? Details);

    public sealed record ReportCommentRequest(Guid TargetCommentId, string Reason, string? Details);

    public sealed record ReportReelCommentRequest(Guid TargetReelCommentId, string Reason, string? Details);

    public sealed record ReportMessageRequest(Guid TargetMessageId, string Reason, string? Details);

    public sealed record ScanRequest(string? Content, string? LinkUrl, Guid? CommunityId, Guid? SourceEntityId, string? SourceType);

    public sealed record ResolveModerationQueueItemRequest(string Resolution, string? ResolutionNote);

    public sealed record UpdateCommunityModerationSettingsRequest(string RulePreset, bool AutoModerationEnabled, int SpamThreshold, int LinkRiskThreshold, IReadOnlyCollection<string>? KeywordFilters);

    public sealed record CreateCommunityShadowMuteRequest(Guid TargetProfileId, string? Reason, DateTime? ExpiresAtUtc);

    public sealed record CreateCommunityBanAppealRequest(string Reason);

    public sealed record ResolveCommunityBanAppealRequest(bool Approved, string? ResolutionNote);

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}
