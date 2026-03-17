using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface ICustomFeedService
{
    Task<IReadOnlyCollection<CustomFeedDto>> GetMineAsync(Guid profileId, CancellationToken cancellationToken = default);
    Task<CustomFeedDto?> GetByIdAsync(Guid profileId, Guid customFeedId, CancellationToken cancellationToken = default);
    Task<CustomFeedDto> CreateAsync(Guid profileId, CreateCustomFeedRequest request, CancellationToken cancellationToken = default);
    Task<CustomFeedDto?> UpdateAsync(Guid profileId, Guid customFeedId, UpdateCustomFeedRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid profileId, Guid customFeedId, CancellationToken cancellationToken = default);
}