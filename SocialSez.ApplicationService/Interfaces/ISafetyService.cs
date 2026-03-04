using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface ISafetyService
{
    Task<SafetyStatusDto> GetStatusAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default);
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
}
