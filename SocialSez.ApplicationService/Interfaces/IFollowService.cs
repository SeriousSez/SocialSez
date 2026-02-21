using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IFollowService
{
    Task<bool> FollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<bool> UnfollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<bool> IsFollowingAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ProfileDto>> GetFollowingAsync(Guid followerId, int take = 100, CancellationToken cancellationToken = default);
    Task<FollowSuggestionsDto> GetSuggestionsAsync(Guid followerId, int takePerGroup = 10, CancellationToken cancellationToken = default);
}
