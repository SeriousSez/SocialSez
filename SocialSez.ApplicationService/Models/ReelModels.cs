namespace SocialSez.ApplicationService.Models;

public sealed record CreateReelRequest(
    Guid AuthorId,
    string? Caption,
    string VideoUrl,
    string? ThumbnailUrl,
    int DurationSeconds,
    bool IsSensitive = false);

public sealed record CreateReelCommentRequest(Guid AuthorId, string Content, Guid? ParentCommentId = null);

public sealed record UpdateReelCommentRequest(string Content);

public sealed record UpdateReelRequest(string? Caption);

public sealed record ReelCommentDto(
    Guid Id,
    Guid ReelId,
    Guid AuthorId,
    Guid? ParentCommentId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string Content,
    DateTime CreatedAtUtc,
    int LikeCount,
    bool LikedByMe);

public sealed record ReelDto(
    Guid Id,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Caption,
    string VideoUrl,
    string? ThumbnailUrl,
    bool IsSensitive,
    int DurationSeconds,
    DateTime CreatedAtUtc,
    int LikeCount,
    bool LikedByMe,
    IReadOnlyCollection<ReelCommentDto> Comments);
