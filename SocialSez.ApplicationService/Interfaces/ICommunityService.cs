using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface ICommunityService
{
    Task<CommunityDto> CreateAsync(Guid creatorProfileId, CreateCommunityRequest request, CancellationToken cancellationToken = default);
    Task<CommunityDto?> UpdateAsync(Guid communityId, Guid actorProfileId, UpdateCommunityRequest request, CancellationToken cancellationToken = default);
    Task<CommunityDto?> GetByIdAsync(Guid communityId, Guid? viewerProfileId = null, int memberTake = 20, CancellationToken cancellationToken = default);
    Task<CommunityDto?> GetBySlugAsync(string slug, Guid? viewerProfileId = null, int memberTake = 20, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<CommunityDto>> GetMineAsync(Guid profileId, int take = 50, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<CommunityDto>> DiscoverAsync(Guid? viewerProfileId, string? query = null, int take = 50, CancellationToken cancellationToken = default);
    Task<CommunityDto?> JoinAsync(Guid communityId, Guid profileId, CancellationToken cancellationToken = default);
    Task<bool> LeaveAsync(Guid communityId, Guid profileId, CancellationToken cancellationToken = default);
    Task<CommunityPostDto?> CreatePostAsync(Guid communityId, CreateCommunityPostRequest request, CancellationToken cancellationToken = default);
    Task<CommunityPostDto?> GetPostByIdAsync(Guid postId, Guid? viewerProfileId, CancellationToken cancellationToken = default);
    Task<bool> DeletePostAsync(Guid communityId, Guid postId, Guid profileId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<CommunityPostDto>> GetPostsAsync(Guid communityId, Guid? viewerProfileId, string? query = null, int take = 50, CancellationToken cancellationToken = default);
    Task<CommunityPostDto?> SavePostAsync(Guid communityId, Guid postId, Guid profileId, CancellationToken cancellationToken = default);
    Task<bool> UnsavePostAsync(Guid communityId, Guid postId, Guid profileId, CancellationToken cancellationToken = default);
    Task<CommunityPollDto?> VotePollAsync(Guid communityId, Guid pollId, VoteCommunityPollRequest request, CancellationToken cancellationToken = default);
}