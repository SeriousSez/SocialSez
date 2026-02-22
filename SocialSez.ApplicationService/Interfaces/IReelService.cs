using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IReelService
{
    Task<ReelDto> CreateAsync(CreateReelRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default);
    Task<ReelDto?> ToggleLikeAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ReelDto>> GetFeedAsync(Guid profileId, int take = 25, CancellationToken cancellationToken = default);
}
