using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IStoryService
{
    Task<StoryDto> CreateAsync(CreateStoryRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid storyId, Guid profileId, CancellationToken cancellationToken = default);
    Task<bool> MarkViewedAsync(Guid storyId, Guid viewerId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<StoryGroupDto>> GetFeedAsync(Guid profileId, int takeAuthors = 25, FeedMode mode = FeedMode.ForYou, CancellationToken cancellationToken = default);
}
