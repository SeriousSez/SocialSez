namespace SocialSez.ApplicationService.Models;

public sealed record CreateReelRequest(
    Guid AuthorId,
    string? Caption,
    string VideoUrl,
    string? ThumbnailUrl,
    int DurationSeconds,
    bool IsSensitive = false,
    bool SaveAsDraft = false,
    DateTime? ScheduledPublishAtUtc = null);

public sealed record CreateReelCommentRequest(Guid AuthorId, string Content, Guid? ParentCommentId = null);

public sealed record UpdateReelCommentRequest(string Content);

public sealed record UpdateReelRequest(string? Caption);

public sealed record TrackReelPlaybackRequest(
    double LastPositionSeconds,
    double WatchedSeconds,
    bool IsCompleted = false);

public sealed record ReelPlaybackDto(
    Guid ReelId,
    double LastPositionSeconds,
    double TotalWatchedSeconds,
    bool IsCompleted,
    DateTime LastViewedAtUtc);

public sealed record CreateReelAbTestRequest(
    string VariantATitle,
    string? VariantAThumbnailUrl,
    string VariantBTitle,
    string? VariantBThumbnailUrl);

public sealed record ReelAbVariantStatsDto(
    string Key,
    string Title,
    string? ThumbnailUrl,
    int Impressions,
    int Views,
    double WatchSeconds,
    double AverageWatchSecondsPerView,
    double ViewRatePercent);

public sealed record ReelAbTestDto(
    Guid ReelId,
    bool IsActive,
    string? WinningVariantKey,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    ReelAbVariantStatsDto VariantA,
    ReelAbVariantStatsDto VariantB);

public sealed record CreatorReelAnalyticsItemDto(
    Guid ReelId,
    string? Caption,
    DateTime CreatedAtUtc,
    int Views,
    double TotalWatchSeconds,
    double AverageWatchSeconds,
    int Saves,
    ReelAbTestDto? ActiveAbTest);

public sealed record CreatorAnalyticsSummaryDto(
    int Days,
    int TotalViews,
    double TotalWatchSeconds,
    int TotalSaves,
    int FollowerGrowth,
    IReadOnlyCollection<CreatorReelAnalyticsItemDto> Reels);

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
    IReadOnlyCollection<ReelCommentDto> Comments,
    int ViewCount = 0,
    double TotalWatchSeconds = 0,
    int SaveCount = 0,
    bool IsDraft = false,
    DateTime? ScheduledPublishAtUtc = null,
    DateTime? PublishedAtUtc = null);
