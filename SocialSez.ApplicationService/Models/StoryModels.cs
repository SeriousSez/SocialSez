namespace SocialSez.ApplicationService.Models;

public sealed record CreateStoryRequest(Guid AuthorId, string? Caption, string MediaUrl, string? ThumbnailUrl = null, bool IsSensitive = false);

public sealed record StoryDto(
    Guid Id,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Caption,
    string MediaUrl,
    string? ThumbnailUrl,
    bool IsSensitive,
    DateTime CreatedAtUtc,
    DateTime ExpiresAtUtc,
    bool ViewedByMe,
    int ViewCount);

public sealed record StoryGroupDto(
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    bool HasUnseenStories,
    IReadOnlyCollection<StoryDto> Stories);

public sealed record StoryCollectionDto(
    Guid Id,
    Guid ProfileId,
    string ProfileHandle,
    string Name,
    DateTime CreatedAtUtc,
    int StoryCount,
    string? CoverMediaUrl,
    IReadOnlyCollection<StoryDto> Stories);

public sealed record CreateStoryCollectionRequest(string Name);
