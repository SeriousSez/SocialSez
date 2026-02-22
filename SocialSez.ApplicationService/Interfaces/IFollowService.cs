using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IFollowService
{
    Task<FollowActionResultDto> FollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<bool> UnfollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<bool> IsFollowingAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<FollowStatusDto> GetStatusAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<FollowRequestDto>> GetIncomingRequestsAsync(Guid profileId, int take = 50, CancellationToken cancellationToken = default);
    Task<bool> ApproveRequestAsync(Guid profileId, Guid followerId, CancellationToken cancellationToken = default);
    Task<bool> DeclineRequestAsync(Guid profileId, Guid followerId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ProfileDto>> GetFollowingAsync(Guid followerId, int take = 100, CancellationToken cancellationToken = default);
    Task<FollowSuggestionsDto> GetSuggestionsAsync(Guid followerId, int takePerGroup = 10, CancellationToken cancellationToken = default);
}
