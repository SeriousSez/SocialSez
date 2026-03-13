namespace SocialSez.ApplicationService.Models;

public sealed record CreatePostRequest(Guid AuthorId, string? Content, IReadOnlyCollection<string>? ImageUrls, bool IsSensitive = false);

public sealed record UpdatePostRequest(string? Content);

public sealed record SetReactionRequest(string Type);

public sealed record CreateCommentRequest(Guid AuthorId, string Content, Guid? ParentCommentId = null);
public sealed record UpdateCommentRequest(string Content);

public sealed record CommentDto(
    Guid Id,
    Guid PostId,
    Guid AuthorId,
    Guid? ParentCommentId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string Content,
    DateTime CreatedAtUtc,
    string? MyReactionType,
    IReadOnlyCollection<ReactionSummaryDto> Reactions);

public sealed record ReactionSummaryDto(string Type, int Count);

public sealed record PostReactionDetailDto(
    Guid ProfileId,
    string Handle,
    string DisplayName,
    string? Bio,
    string? ImageUrl,
    string ReactionType,
    DateTime ReactedAtUtc);

public sealed record HashtagSearchResultDto(string Tag, int Count);

public sealed record FollowedHashtagDto(string Tag, DateTime FollowedAtUtc);

public sealed record HashtagReelDto(
    Guid Id,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Caption,
    string? ThumbnailUrl,
    DateTime CreatedAtUtc);

public sealed record HashtagCommunityDto(
    Guid Id,
    string Slug,
    string Name,
    string? Description,
    string? ImageUrl,
    bool IsPrivate,
    int MemberCount);

public sealed record HashtagCommunityPostDto(
    Guid Id,
    Guid CommunityId,
    string CommunitySlug,
    string CommunityName,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Title,
    string? Content,
    DateTime CreatedAtUtc);

public sealed record HashtagBlogDto(
    Guid Id,
    Guid OwnerProfileId,
    string OwnerHandle,
    string Slug,
    string Title,
    string? Description,
    DateTime UpdatedAtUtc);

public sealed record HashtagBlogPostDto(
    Guid Id,
    Guid BlogId,
    string BlogSlug,
    string AuthorHandle,
    string Slug,
    string Title,
    string? Excerpt,
    string? CoverImageUrl,
    DateTime UpdatedAtUtc);

public sealed record HashtagContentDto(
    IReadOnlyCollection<PostDto> Posts,
    IReadOnlyCollection<HashtagReelDto> Reels,
    IReadOnlyCollection<HashtagCommunityDto> Communities,
    IReadOnlyCollection<HashtagCommunityPostDto> CommunityPosts,
    IReadOnlyCollection<HashtagBlogDto> Blogs,
    IReadOnlyCollection<HashtagBlogPostDto> BlogPosts);

public sealed record PostDto(
    Guid Id,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string Content,
    string? ImageUrl,
    IReadOnlyCollection<string> ImageUrls,
    bool IsSensitive,
    DateTime CreatedAtUtc,
    int LikeCount,
    bool LikedByMe,
    string? MyReactionType,
    IReadOnlyCollection<ReactionSummaryDto> Reactions,
    IReadOnlyCollection<PostReactionDetailDto> ReactionDetails,
    IReadOnlyCollection<CommentDto> Comments);
