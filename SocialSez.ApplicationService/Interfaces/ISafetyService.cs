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
}
