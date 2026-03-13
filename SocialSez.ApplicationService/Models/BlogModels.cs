namespace SocialSez.ApplicationService.Models;

public sealed record BlogThemeConfigDto(
    string? FontFamily,
    string? AccentColor,
    string? BackgroundColor,
    string? SurfaceColor,
    string? HeaderLayout,
    string? PostListLayout,
    string? CustomCss);

public sealed record CreateBlogRequest(
    string Title,
    string? Description,
    string? Slug,
    bool IsPublic,
    bool AllowLikes,
    bool AllowComments,
    bool AllowShares,
    bool AllowEmbeds,
    BlogThemeConfigDto? Theme);

public sealed record UpdateBlogRequest(
    string Title,
    string? Description,
    string? Slug,
    bool IsPublic,
    bool AllowLikes,
    bool AllowComments,
    bool AllowShares,
    bool AllowEmbeds,
    BlogThemeConfigDto? Theme);

public sealed record BlogDto(
    Guid Id,
    Guid OwnerProfileId,
    string OwnerHandle,
    string Slug,
    string Title,
    string? Description,
    bool IsPublic,
    bool AllowLikes,
    bool AllowComments,
    bool AllowShares,
    bool AllowEmbeds,
    BlogThemeConfigDto Theme,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    bool IsOwner);

public sealed record CreateBlogPostRequest(
    string Title,
    string Content,
    string? Excerpt,
    string? CoverImageUrl,
    IReadOnlyCollection<string>? Tags,
    bool IsPublished,
    string? Slug);

public sealed record UpdateBlogPostRequest(
    string Title,
    string Content,
    string? Excerpt,
    string? CoverImageUrl,
    IReadOnlyCollection<string>? Tags,
    bool IsPublished,
    string? Slug);

public sealed record BlogPostDto(
    Guid Id,
    Guid BlogId,
    string BlogSlug,
    Guid AuthorProfileId,
    string AuthorHandle,
    string Slug,
    string Title,
    string Content,
    string? Excerpt,
    string? CoverImageUrl,
    IReadOnlyCollection<string> Tags,
    bool IsPublished,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    DateTime? PublishedAtUtc,
    bool IsOwner,
    bool IsSavedByMe);
