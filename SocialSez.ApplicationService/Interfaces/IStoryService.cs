using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IStoryService
{
    Task<StoryDto> CreateAsync(CreateStoryRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid storyId, Guid profileId, CancellationToken cancellationToken = default);
    Task<bool> MarkViewedAsync(Guid storyId, Guid viewerId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<StoryDto>> GetDraftsAsync(Guid profileId, int take = 50, CancellationToken cancellationToken = default);
    Task<StoryPlaybackProgressDto?> UpsertPlaybackProgressAsync(Guid viewerId, Guid authorId, UpsertStoryPlaybackProgressRequest request, CancellationToken cancellationToken = default);
    Task<StoryPlaybackProgressDto?> GetPlaybackProgressAsync(Guid viewerId, Guid authorId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<StoryGroupDto>> GetFeedAsync(Guid profileId, int takeAuthors = 25, FeedMode mode = FeedMode.ForYou, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<StoryDto>> GetByAuthorAsync(Guid requesterId, Guid authorId, bool includeExpired = false, int take = 100, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<StoryCollectionDto>> GetCollectionsByAuthorHandleAsync(string handle, Guid? viewerId = null, CancellationToken cancellationToken = default);
    Task<StoryCollectionDto> CreateCollectionAsync(Guid profileId, string name, CancellationToken cancellationToken = default);
    Task DeleteCollectionAsync(Guid profileId, Guid collectionId, CancellationToken cancellationToken = default);
    Task<StoryCollectionDto> AddStoryToCollectionAsync(Guid profileId, Guid collectionId, Guid storyId, CancellationToken cancellationToken = default);
    Task<StoryCollectionDto> RemoveStoryFromCollectionAsync(Guid profileId, Guid collectionId, Guid storyId, CancellationToken cancellationToken = default);
    Task<StoryGroupDto?> GetPublicByAuthorHandleAsync(string handle, Guid? viewerId = null, CancellationToken cancellationToken = default);
    Task<StoryDto?> GetPublicByIdAsync(Guid storyId, CancellationToken cancellationToken = default);
    Task<StoryDto?> GetPublicByIdAsync(Guid storyId, Guid? viewerId, CancellationToken cancellationToken = default);
}
