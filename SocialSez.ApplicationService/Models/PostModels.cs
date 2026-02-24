namespace SocialSez.ApplicationService.Models;

public sealed record CreatePostRequest(Guid AuthorId, string? Content, string? ImageUrl);

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

public sealed record HashtagSearchResultDto(string Tag, int Count);

public sealed record PostDto(
    Guid Id,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string Content,
    string? ImageUrl,
    DateTime CreatedAtUtc,
    int LikeCount,
    bool LikedByMe,
    string? MyReactionType,
    IReadOnlyCollection<ReactionSummaryDto> Reactions,
    IReadOnlyCollection<CommentDto> Comments);
