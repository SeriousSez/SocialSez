using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IReelService
{
    Task<ReelDto> CreateAsync(CreateReelRequest request, CancellationToken cancellationToken = default);
    Task<ReelDto?> UpdateAsync(Guid reelId, Guid profileId, UpdateReelRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default);
    Task<ReelDto?> ToggleLikeAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default);
    Task<ReelDto?> AddCommentAsync(Guid reelId, CreateReelCommentRequest request, CancellationToken cancellationToken = default);
    Task<ReelDto?> UpdateCommentAsync(Guid reelId, Guid commentId, Guid profileId, UpdateReelCommentRequest request, CancellationToken cancellationToken = default);
    Task<ReelDto?> DeleteCommentAsync(Guid reelId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default);
    Task<ReelDto?> ToggleCommentLikeAsync(Guid reelId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ReelDto>> GetFeedAsync(Guid profileId, int take = 25, FeedMode mode = FeedMode.ForYou, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ReelDto>> GetByAuthorHandleAsync(Guid profileId, string handle, int take = 25, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ReelDto>> GetPublicByAuthorHandleAsync(string handle, Guid? viewerId = null, int take = 25, CancellationToken cancellationToken = default);
    Task<ReelDto?> GetPublicByIdAsync(Guid reelId, Guid? viewerId = null, CancellationToken cancellationToken = default);
}
