namespace SocialSez.ApplicationService.Models;

public sealed record CreateStoryRequest(Guid AuthorId, string? Caption, string MediaUrl, int? ExpiresInHours);

public sealed record StoryDto(
    Guid Id,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Caption,
    string MediaUrl,
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
