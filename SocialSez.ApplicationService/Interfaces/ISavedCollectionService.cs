using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface ISavedCollectionService
{
    Task<IReadOnlyList<SavedItemDto>> GetAllSavedItemsAsync(Guid profileId, int take, int skip);
    Task<IReadOnlyList<SavedCollectionDto>> GetCollectionsAsync(Guid profileId);
    Task<SavedCollectionDto> CreateCollectionAsync(Guid profileId, string name);
    Task DeleteCollectionAsync(Guid profileId, Guid collectionId);
    Task<SavedCollectionDto> RenameCollectionAsync(Guid profileId, Guid collectionId, string name);
    Task<IReadOnlyList<SavedItemDto>> GetCollectionItemsAsync(Guid profileId, Guid collectionId, int take, int skip);
    Task<SavedItemDto> SavePostAsync(Guid profileId, Guid postId);
    Task<SavedItemDto> SaveReelAsync(Guid profileId, Guid reelId);
    Task UnsaveItemAsync(Guid profileId, Guid savedItemId);
    Task AddToCollectionAsync(Guid profileId, Guid savedItemId, Guid collectionId);
    Task RemoveFromCollectionAsync(Guid profileId, Guid savedItemId, Guid collectionId);
    Task<SavedStatusDto> GetSavedStatusAsync(Guid profileId, IEnumerable<Guid> postIds, IEnumerable<Guid> reelIds);
}
