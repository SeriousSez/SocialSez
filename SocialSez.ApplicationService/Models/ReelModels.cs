namespace SocialSez.ApplicationService.Models;

public sealed record CreateReelRequest(
    Guid AuthorId,
    string? Caption,
    string VideoUrl,
    string? ThumbnailUrl,
    int DurationSeconds);

public sealed record ReelDto(
    Guid Id,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Caption,
    string VideoUrl,
    string? ThumbnailUrl,
    int DurationSeconds,
    DateTime CreatedAtUtc,
    int LikeCount,
    bool LikedByMe);
