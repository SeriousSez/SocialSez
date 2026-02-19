namespace SocialSez.ApplicationService.Interfaces;

public interface IFollowService
{
    Task<bool> FollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<bool> UnfollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
    Task<bool> IsFollowingAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default);
}
