using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface ISafetyService
{
    Task<SafetyStatusDto> GetStatusAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default);
    Task<ReputationScoreDto?> GetReputationScoreAsync(Guid targetProfileId, CancellationToken cancellationToken = default);
    Task<ContentModerationScanResultDto> ScanContentAsync(Guid actorProfileId, ContentModerationScanRequestDto request, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ProfileDto>> GetBlockedProfilesAsync(Guid actorProfileId, int take = 100, CancellationToken cancellationToken = default);
    Task<bool> BlockAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default);
    Task<bool> UnblockAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default);
    Task<bool> MuteAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default);
    Task<bool> UnmuteAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default);
    Task<bool> ReportAsync(Guid actorProfileId, Guid targetProfileId, ReportProfileRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> ReportPostAsync(Guid actorProfileId, Guid targetPostId, ReportContentRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> ReportReelAsync(Guid actorProfileId, Guid targetReelId, ReportContentRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> ReportStoryAsync(Guid actorProfileId, Guid targetStoryId, ReportContentRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> ReportCommentAsync(Guid actorProfileId, Guid targetCommentId, ReportContentRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> ReportReelCommentAsync(Guid actorProfileId, Guid targetReelCommentId, ReportContentRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> ReportMessageAsync(Guid actorProfileId, Guid targetMessageId, ReportContentRequestDto request, CancellationToken cancellationToken = default);
    Task<CommunityModerationSettingsDto?> GetCommunityModerationSettingsAsync(Guid communityId, Guid actorProfileId, CancellationToken cancellationToken = default);
    Task<CommunityModerationSettingsDto?> UpdateCommunityModerationSettingsAsync(Guid communityId, Guid actorProfileId, UpdateCommunityModerationSettingsRequestDto request, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<CommunityShadowMuteDto>> GetCommunityShadowMutesAsync(Guid communityId, Guid actorProfileId, int take = 100, CancellationToken cancellationToken = default);
    Task<CommunityShadowMuteDto?> AddCommunityShadowMuteAsync(Guid communityId, Guid actorProfileId, CreateCommunityShadowMuteRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> RemoveCommunityShadowMuteAsync(Guid communityId, Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default);
    Task<CommunityBanAppealDto?> SubmitCommunityBanAppealAsync(Guid communityId, Guid actorProfileId, CreateCommunityBanAppealRequestDto request, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<CommunityBanAppealDto>> GetCommunityBanAppealsAsync(Guid communityId, Guid actorProfileId, string? status = null, int take = 100, CancellationToken cancellationToken = default);
    Task<CommunityBanAppealDto?> ResolveCommunityBanAppealAsync(Guid communityId, Guid actorProfileId, Guid appealId, ResolveCommunityBanAppealRequestDto request, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ModerationQueueItemDto>> GetModerationQueueAsync(Guid actorProfileId, Guid? communityId = null, string? status = "Open", int take = 100, CancellationToken cancellationToken = default);
    Task<ModerationQueueItemDto?> ResolveModerationQueueItemAsync(Guid queueItemId, Guid actorProfileId, ResolveModerationQueueItemRequestDto request, CancellationToken cancellationToken = default);
}
