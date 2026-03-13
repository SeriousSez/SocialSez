namespace SocialSez.ApplicationService.Models;

public sealed record SavedItemDto(
    Guid Id,
    string ItemType,       // "Post" | "Reel" | "CommunityPost" | "BlogPost"
    Guid? PostId,
    Guid? ReelId,
    Guid? CommunityPostId,
    Guid? BlogPostId,
    DateTime SavedAtUtc,
    PostDto? Post,
    ReelDto? Reel,
    CommunityPostDto? CommunityPost,
    BlogPostDto? BlogPost
);

public sealed record SavedCollectionDto(
    Guid Id,
    string Name,
    DateTime CreatedAtUtc,
    int ItemCount,
    string? CoverThumbnailUrl
);

public sealed record SavedStatusDto(
    IReadOnlyDictionary<Guid, Guid> SavedPostIds,   // postId → savedItemId
    IReadOnlyDictionary<Guid, Guid> SavedReelIds    // reelId → savedItemId
);

public sealed record CreateCollectionRequest(string Name);
public sealed record RenameCollectionRequest(string Name);
