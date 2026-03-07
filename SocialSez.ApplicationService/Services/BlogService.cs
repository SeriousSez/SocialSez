using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class BlogService(SocialSezContext dbContext, IMemoryCache memoryCache) : IBlogService
{
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool schemaInitialized;
    private static readonly TimeSpan SearchCacheTtl = TimeSpan.FromSeconds(30);

    public async Task<BlogDto> CreateAsync(Guid ownerProfileId, CreateBlogRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var owner = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == ownerProfileId, cancellationToken)
            ?? throw new InvalidOperationException("Owner profile was not found.");

        var title = NormalizeTitle(request.Title);
        var description = NormalizeDescription(request.Description);
        var slug = await BuildUniqueBlogSlugAsync(ownerProfileId, request.Slug, title, cancellationToken);
        var theme = NormalizeTheme(request.Theme);
        var nowUtc = DateTime.UtcNow;

        var blog = new Blog
        {
            Id = Guid.NewGuid(),
            OwnerProfileId = ownerProfileId,
            OwnerProfile = owner,
            Slug = slug,
            Title = title,
            Description = description,
            ThemeConfigJson = SerializeTheme(theme),
            IsPublic = request.IsPublic,
            CreatedAtUtc = nowUtc,
            UpdatedAtUtc = nowUtc
        };

        dbContext.Blogs.Add(blog);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpBlog();

        return MapBlog(blog, ownerProfileId);
    }

    public async Task<BlogDto?> UpdateAsync(Guid blogId, Guid ownerProfileId, UpdateBlogRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var blog = await dbContext.Blogs
            .Include(x => x.OwnerProfile)
            .FirstOrDefaultAsync(x => x.Id == blogId, cancellationToken);

        if (blog is null)
        {
            return null;
        }

        if (blog.OwnerProfileId != ownerProfileId)
        {
            throw new UnauthorizedAccessException("Only the blog owner can update this blog.");
        }

        var title = NormalizeTitle(request.Title);
        var description = NormalizeDescription(request.Description);
        var theme = NormalizeTheme(request.Theme);

        blog.Title = title;
        blog.Description = description;
        blog.IsPublic = request.IsPublic;
        blog.ThemeConfigJson = SerializeTheme(theme);
        blog.Slug = await BuildUniqueBlogSlugAsync(ownerProfileId, request.Slug, title, cancellationToken, blog.Id);
        blog.UpdatedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpBlog();
        return MapBlog(blog, ownerProfileId);
    }

    public async Task<IReadOnlyCollection<BlogDto>> GetMineAsync(Guid ownerProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var blogs = await dbContext.Blogs
            .AsNoTracking()
            .Include(x => x.OwnerProfile)
            .Where(x => x.OwnerProfileId == ownerProfileId)
            .OrderByDescending(x => x.UpdatedAtUtc)
            .ToArrayAsync(cancellationToken);

        return blogs.Select(blog => MapBlog(blog, ownerProfileId)).ToArray();
    }

    public async Task<IReadOnlyCollection<BlogDto>> DiscoverAsync(Guid? viewerProfileId = null, string? query = null, int take = 60, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var resolvedTake = Math.Clamp(take, 1, 200);
        var normalizedQuery = DiscoverySearchBackend.NormalizeQuery(query);
        var expandedTerms = DiscoverySearchBackend.ExpandTerms(normalizedQuery);
        var candidateTake = Math.Clamp(resolvedTake * 4, resolvedTake, 320);

        var cacheKey = $"blog:discover:v3:blogv={SearchCacheVersionStamp.BlogVersion}:viewer={viewerProfileId?.ToString() ?? "anon"}:q={normalizedQuery ?? string.Empty}:take={resolvedTake}";
        return await SearchResultCache.GetOrCreateAsync(memoryCache, cacheKey, SearchCacheTtl, async () =>
        {
            var blogsQuery = dbContext.Blogs
                .AsNoTracking()
                .Include(x => x.OwnerProfile)
                .Where(x => x.IsPublic || (viewerProfileId.HasValue && x.OwnerProfileId == viewerProfileId.Value));

            var candidates = await blogsQuery
                .OrderByDescending(x => x.UpdatedAtUtc)
                .Take(candidateTake)
                .ToArrayAsync(cancellationToken);

            var blogs = expandedTerms.Count > 0
                ? candidates
                    .Select(blog => new
                    {
                        Blog = blog,
                        Score = DiscoverySearchBackend.ScoreFields(expandedTerms,
                            (blog.Title, 1.7),
                            (blog.Slug, 1.2),
                            (blog.OwnerProfile.Handle, 1.0),
                            (blog.Description, 1.3))
                    })
                    .Where(x => x.Score > 0)
                    .OrderByDescending(x => x.Score)
                    .ThenByDescending(x => x.Blog.UpdatedAtUtc)
                    .Take(resolvedTake)
                    .Select(x => x.Blog)
                    .ToArray()
                : candidates
                    .Take(resolvedTake)
                    .ToArray();

            return blogs.Select(blog => MapBlog(blog, viewerProfileId)).ToArray();
        });
    }

    public async Task<IReadOnlyCollection<BlogDto>> GetFollowingAsync(Guid viewerProfileId, string? query = null, int take = 60, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var resolvedTake = Math.Clamp(take, 1, 200);
        var normalizedQuery = DiscoverySearchBackend.NormalizeQuery(query);
        var expandedTerms = DiscoverySearchBackend.ExpandTerms(normalizedQuery);
        var candidateTake = Math.Clamp(resolvedTake * 4, resolvedTake, 320);

        var cacheKey = $"blog:following:v3:blogv={SearchCacheVersionStamp.BlogVersion}:viewer={viewerProfileId}:q={normalizedQuery ?? string.Empty}:take={resolvedTake}";
        return await SearchResultCache.GetOrCreateAsync(memoryCache, cacheKey, SearchCacheTtl, async () =>
        {
            var followedProfileIds = dbContext.Follows
                .AsNoTracking()
                .Where(x => x.FollowerId == viewerProfileId)
                .Select(x => x.FollowedId);

            var blogsQuery = dbContext.Blogs
                .AsNoTracking()
                .Include(x => x.OwnerProfile)
                .Where(x => x.IsPublic && followedProfileIds.Contains(x.OwnerProfileId));

            var candidates = await blogsQuery
                .OrderByDescending(x => x.UpdatedAtUtc)
                .Take(candidateTake)
                .ToArrayAsync(cancellationToken);

            var blogs = expandedTerms.Count > 0
                ? candidates
                    .Select(blog => new
                    {
                        Blog = blog,
                        Score = DiscoverySearchBackend.ScoreFields(expandedTerms,
                            (blog.Title, 1.7),
                            (blog.Slug, 1.2),
                            (blog.OwnerProfile.Handle, 1.0),
                            (blog.Description, 1.3))
                    })
                    .Where(x => x.Score > 0)
                    .OrderByDescending(x => x.Score)
                    .ThenByDescending(x => x.Blog.UpdatedAtUtc)
                    .Take(resolvedTake)
                    .Select(x => x.Blog)
                    .ToArray()
                : candidates
                    .Take(resolvedTake)
                    .ToArray();

            return blogs.Select(blog => MapBlog(blog, viewerProfileId)).ToArray();
        });
    }

    public async Task<IReadOnlyCollection<BlogDto>> GetByOwnerHandleAsync(string handle, Guid? viewerProfileId = null, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var normalizedHandle = NormalizeHandle(handle);
        var owner = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Handle == normalizedHandle, cancellationToken);

        if (owner is null)
        {
            return Array.Empty<BlogDto>();
        }

        var canViewPrivate = viewerProfileId.HasValue && viewerProfileId.Value == owner.Id;

        var blogsQuery = dbContext.Blogs
            .AsNoTracking()
            .Include(x => x.OwnerProfile)
            .Where(x => x.OwnerProfileId == owner.Id);

        if (!canViewPrivate)
        {
            blogsQuery = blogsQuery.Where(x => x.IsPublic);
        }

        var blogs = await blogsQuery
            .OrderByDescending(x => x.UpdatedAtUtc)
            .ToArrayAsync(cancellationToken);

        return blogs.Select(blog => MapBlog(blog, viewerProfileId)).ToArray();
    }

    public async Task<BlogDto?> GetByOwnerHandleAndSlugAsync(string handle, string blogSlug, Guid? viewerProfileId = null, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var normalizedHandle = NormalizeHandle(handle);
        var normalizedSlug = NormalizeSlug(blogSlug);

        if (string.IsNullOrWhiteSpace(normalizedHandle) || string.IsNullOrWhiteSpace(normalizedSlug))
        {
            return null;
        }

        var blog = await dbContext.Blogs
            .AsNoTracking()
            .Include(x => x.OwnerProfile)
            .FirstOrDefaultAsync(x => x.OwnerProfile.Handle == normalizedHandle && x.Slug == normalizedSlug, cancellationToken);

        if (blog is null)
        {
            return null;
        }

        var isOwner = viewerProfileId.HasValue && viewerProfileId.Value == blog.OwnerProfileId;
        if (!blog.IsPublic && !isOwner)
        {
            return null;
        }

        return MapBlog(blog, viewerProfileId);
    }

    public async Task<BlogPostDto> CreatePostAsync(Guid blogId, Guid authorProfileId, CreateBlogPostRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var blog = await dbContext.Blogs
            .Include(x => x.OwnerProfile)
            .FirstOrDefaultAsync(x => x.Id == blogId, cancellationToken)
            ?? throw new InvalidOperationException("Blog was not found.");

        if (blog.OwnerProfileId != authorProfileId)
        {
            throw new UnauthorizedAccessException("Only the blog owner can create posts.");
        }

        var author = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == authorProfileId, cancellationToken)
            ?? throw new InvalidOperationException("Author profile was not found.");

        var title = NormalizePostTitle(request.Title);
        var content = NormalizePostContent(request.Content);
        var excerpt = NormalizeExcerpt(request.Excerpt);
        var coverImageUrl = NormalizeCoverImageUrl(request.CoverImageUrl);
        var tags = NormalizeTags(request.Tags);
        var slug = await BuildUniquePostSlugAsync(blogId, request.Slug, title, cancellationToken);
        var nowUtc = DateTime.UtcNow;

        var post = new BlogPost
        {
            Id = Guid.NewGuid(),
            BlogId = blogId,
            Blog = blog,
            AuthorProfileId = authorProfileId,
            AuthorProfile = author,
            Slug = slug,
            Title = title,
            Content = content,
            Excerpt = excerpt,
            CoverImageUrl = coverImageUrl,
            TagsJson = SerializeTags(tags),
            IsPublished = request.IsPublished,
            CreatedAtUtc = nowUtc,
            UpdatedAtUtc = nowUtc,
            PublishedAtUtc = request.IsPublished ? nowUtc : null
        };

        dbContext.BlogPosts.Add(post);
        blog.UpdatedAtUtc = nowUtc;

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpBlog();
        return MapPost(post, blog, author, authorProfileId);
    }

    public async Task<BlogPostDto?> UpdatePostAsync(Guid blogId, Guid postId, Guid authorProfileId, UpdateBlogPostRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var post = await dbContext.BlogPosts
            .Include(x => x.Blog)
                .ThenInclude(x => x.OwnerProfile)
            .Include(x => x.AuthorProfile)
            .FirstOrDefaultAsync(x => x.Id == postId && x.BlogId == blogId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        if (post.Blog.OwnerProfileId != authorProfileId)
        {
            throw new UnauthorizedAccessException("Only the blog owner can update posts.");
        }

        var title = NormalizePostTitle(request.Title);

        post.Title = title;
        post.Content = NormalizePostContent(request.Content);
        post.Excerpt = NormalizeExcerpt(request.Excerpt);
        post.CoverImageUrl = NormalizeCoverImageUrl(request.CoverImageUrl);
        post.TagsJson = SerializeTags(NormalizeTags(request.Tags));
        post.Slug = await BuildUniquePostSlugAsync(blogId, request.Slug, title, cancellationToken, post.Id);

        var wasPublished = post.IsPublished;
        post.IsPublished = request.IsPublished;
        if (post.IsPublished && !wasPublished)
        {
            post.PublishedAtUtc = DateTime.UtcNow;
        }
        else if (!post.IsPublished)
        {
            post.PublishedAtUtc = null;
        }

        post.UpdatedAtUtc = DateTime.UtcNow;
        post.Blog.UpdatedAtUtc = post.UpdatedAtUtc;

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpBlog();
        return MapPost(post, post.Blog, post.AuthorProfile, authorProfileId);
    }

    public async Task<bool> DeleteAsync(Guid blogId, Guid ownerProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var blog = await dbContext.Blogs
            .FirstOrDefaultAsync(x => x.Id == blogId, cancellationToken);

        if (blog is null)
        {
            return false;
        }

        if (blog.OwnerProfileId != ownerProfileId)
        {
            throw new UnauthorizedAccessException("Only the blog owner can delete this blog.");
        }

        dbContext.Blogs.Remove(blog);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpBlog();
        return true;
    }

    public async Task<bool> DeletePostAsync(Guid blogId, Guid postId, Guid authorProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var post = await dbContext.BlogPosts
            .Include(x => x.Blog)
            .FirstOrDefaultAsync(x => x.Id == postId && x.BlogId == blogId, cancellationToken);

        if (post is null)
        {
            return false;
        }

        if (post.Blog.OwnerProfileId != authorProfileId)
        {
            throw new UnauthorizedAccessException("Only the blog owner can delete posts.");
        }

        dbContext.BlogPosts.Remove(post);
        post.Blog.UpdatedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpBlog();
        return true;
    }

    public async Task<IReadOnlyCollection<BlogPostDto>> GetPostsAsync(string handle, string blogSlug, Guid? viewerProfileId = null, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var blog = await dbContext.Blogs
            .AsNoTracking()
            .Include(x => x.OwnerProfile)
            .FirstOrDefaultAsync(x => x.OwnerProfile.Handle == NormalizeHandle(handle) && x.Slug == NormalizeSlug(blogSlug), cancellationToken);

        if (blog is null)
        {
            return Array.Empty<BlogPostDto>();
        }

        var isOwner = viewerProfileId.HasValue && viewerProfileId.Value == blog.OwnerProfileId;
        if (!blog.IsPublic && !isOwner)
        {
            return Array.Empty<BlogPostDto>();
        }

        var postsQuery = dbContext.BlogPosts
            .AsNoTracking()
            .Include(x => x.AuthorProfile)
            .Where(x => x.BlogId == blog.Id);

        if (!isOwner)
        {
            postsQuery = postsQuery.Where(x => x.IsPublished);
        }

        var posts = await postsQuery
            .OrderByDescending(x => x.PublishedAtUtc ?? x.UpdatedAtUtc)
            .ToArrayAsync(cancellationToken);

        return posts.Select(post => MapPost(post, blog, post.AuthorProfile, viewerProfileId)).ToArray();
    }

    public async Task<BlogPostDto?> GetPostBySlugAsync(string handle, string blogSlug, string postSlug, Guid? viewerProfileId = null, CancellationToken cancellationToken = default)
    {
        await EnsureBlogSchemaAsync(cancellationToken);

        var normalizedHandle = NormalizeHandle(handle);
        var normalizedBlogSlug = NormalizeSlug(blogSlug);
        var normalizedPostSlug = NormalizeSlug(postSlug);

        var post = await dbContext.BlogPosts
            .AsNoTracking()
            .Include(x => x.Blog)
                .ThenInclude(x => x.OwnerProfile)
            .Include(x => x.AuthorProfile)
            .FirstOrDefaultAsync(x => x.Blog.OwnerProfile.Handle == normalizedHandle
                && x.Blog.Slug == normalizedBlogSlug
                && x.Slug == normalizedPostSlug, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var isOwner = viewerProfileId.HasValue && viewerProfileId.Value == post.Blog.OwnerProfileId;
        if ((!post.Blog.IsPublic || !post.IsPublished) && !isOwner)
        {
            return null;
        }

        return MapPost(post, post.Blog, post.AuthorProfile, viewerProfileId);
    }

    private static string NormalizeTitle(string title)
    {
        var normalized = (title ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Blog title is required.", nameof(title));
        }

        return normalized.Length > 160 ? normalized[..160].Trim() : normalized;
    }

    private static string? NormalizeDescription(string? description)
    {
        if (string.IsNullOrWhiteSpace(description))
        {
            return null;
        }

        var normalized = description.Trim();
        return normalized.Length > 1000 ? normalized[..1000].Trim() : normalized;
    }

    private static string NormalizePostTitle(string title)
    {
        var normalized = (title ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Post title is required.", nameof(title));
        }

        return normalized.Length > 220 ? normalized[..220].Trim() : normalized;
    }

    private static string NormalizePostContent(string content)
    {
        var normalized = (content ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Post content is required.", nameof(content));
        }

        return normalized.Length > 200000 ? normalized[..200000].Trim() : normalized;
    }

    private static string? NormalizeExcerpt(string? excerpt)
    {
        if (string.IsNullOrWhiteSpace(excerpt))
        {
            return null;
        }

        var normalized = excerpt.Trim();
        return normalized.Length > 800 ? normalized[..800].Trim() : normalized;
    }

    private static string? NormalizeCoverImageUrl(string? coverImageUrl)
    {
        if (string.IsNullOrWhiteSpace(coverImageUrl))
        {
            return null;
        }

        var normalized = coverImageUrl.Trim();
        return normalized.Length > 2048 ? normalized[..2048].Trim() : normalized;
    }

    private static IReadOnlyCollection<string> NormalizeTags(IReadOnlyCollection<string>? tags)
    {
        if (tags is null || tags.Count == 0)
        {
            return Array.Empty<string>();
        }

        var normalized = tags
            .Select(tag => (tag ?? string.Empty).Trim())
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .Select(tag => tag.Length > 40 ? tag[..40].Trim() : tag)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(20)
            .ToArray();

        return normalized;
    }

    private static string SerializeTags(IReadOnlyCollection<string> tags)
    {
        return tags.Count == 0 ? "[]" : JsonSerializer.Serialize(tags);
    }

    private static IReadOnlyCollection<string> ParseTags(string? tagsJson)
    {
        if (string.IsNullOrWhiteSpace(tagsJson))
        {
            return Array.Empty<string>();
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<List<string>>(tagsJson) ?? [];
            return NormalizeTags(parsed);
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static BlogThemeConfigDto NormalizeTheme(BlogThemeConfigDto? theme)
    {
        return new BlogThemeConfigDto(
            NormalizeThemeField(theme?.FontFamily, 100),
            NormalizeThemeField(theme?.AccentColor, 30),
            NormalizeThemeField(theme?.BackgroundColor, 30),
            NormalizeThemeField(theme?.SurfaceColor, 30),
            NormalizeThemeField(theme?.HeaderLayout, 40),
            NormalizeThemeField(theme?.PostListLayout, 40),
            NormalizeThemeField(theme?.CustomCss, 12000));
    }

    private static string? NormalizeThemeField(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        return normalized.Length > maxLength ? normalized[..maxLength].Trim() : normalized;
    }

    private static string SerializeTheme(BlogThemeConfigDto theme)
    {
        return JsonSerializer.Serialize(theme);
    }

    private static BlogThemeConfigDto ParseTheme(string? themeConfigJson)
    {
        if (string.IsNullOrWhiteSpace(themeConfigJson))
        {
            return NormalizeTheme(null);
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<BlogThemeConfigDto>(themeConfigJson);
            return NormalizeTheme(parsed);
        }
        catch
        {
            return NormalizeTheme(null);
        }
    }

    private static string NormalizeSlug(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        normalized = Regex.Replace(normalized, "[^a-z0-9\\-\\s]", string.Empty);
        normalized = Regex.Replace(normalized, "\\s+", "-");
        normalized = Regex.Replace(normalized, "-+", "-").Trim('-');
        return normalized;
    }

    private static string NormalizeHandle(string? value)
    {
        return (value ?? string.Empty).Trim().ToLowerInvariant();
    }

    private static string BuildSlugFallback(string source, string fallback)
    {
        var normalized = NormalizeSlug(source);
        return string.IsNullOrWhiteSpace(normalized) ? fallback : normalized;
    }

    private async Task<string> BuildUniqueBlogSlugAsync(Guid ownerProfileId, string? requestedSlug, string title, CancellationToken cancellationToken, Guid? currentBlogId = null)
    {
        var baseSlug = BuildSlugFallback(requestedSlug ?? title, "blog");
        var candidate = baseSlug;
        var index = 1;

        while (await dbContext.Blogs.AnyAsync(x => x.OwnerProfileId == ownerProfileId && x.Slug == candidate && (!currentBlogId.HasValue || x.Id != currentBlogId.Value), cancellationToken))
        {
            index += 1;
            candidate = $"{baseSlug}-{index}";
        }

        return candidate;
    }

    private async Task<string> BuildUniquePostSlugAsync(Guid blogId, string? requestedSlug, string title, CancellationToken cancellationToken, Guid? currentPostId = null)
    {
        var baseSlug = BuildSlugFallback(requestedSlug ?? title, "post");
        var candidate = baseSlug;
        var index = 1;

        while (await dbContext.BlogPosts.AnyAsync(x => x.BlogId == blogId && x.Slug == candidate && (!currentPostId.HasValue || x.Id != currentPostId.Value), cancellationToken))
        {
            index += 1;
            candidate = $"{baseSlug}-{index}";
        }

        return candidate;
    }

    private static BlogDto MapBlog(Blog blog, Guid? viewerProfileId)
    {
        return new BlogDto(
            blog.Id,
            blog.OwnerProfileId,
            blog.OwnerProfile.Handle,
            blog.Slug,
            blog.Title,
            blog.Description,
            blog.IsPublic,
            ParseTheme(blog.ThemeConfigJson),
            blog.CreatedAtUtc,
            blog.UpdatedAtUtc,
            viewerProfileId.HasValue && viewerProfileId.Value == blog.OwnerProfileId);
    }

    private static BlogPostDto MapPost(BlogPost post, Blog blog, UserProfile author, Guid? viewerProfileId)
    {
        return new BlogPostDto(
            post.Id,
            post.BlogId,
            blog.Slug,
            post.AuthorProfileId,
            author.Handle,
            post.Slug,
            post.Title,
            post.Content,
            post.Excerpt,
            post.CoverImageUrl,
            ParseTags(post.TagsJson),
            post.IsPublished,
            post.CreatedAtUtc,
            post.UpdatedAtUtc,
            post.PublishedAtUtc,
            viewerProfileId.HasValue && viewerProfileId.Value == blog.OwnerProfileId);
    }

    private async Task EnsureBlogSchemaAsync(CancellationToken cancellationToken)
    {
        if (schemaInitialized)
        {
            return;
        }

        await SchemaInitLock.WaitAsync(cancellationToken);
        try
        {
            if (schemaInitialized)
            {
                return;
            }

            if (dbContext.Database.IsSqlite())
            {
                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS Blogs (
                    Id TEXT NOT NULL PRIMARY KEY,
                    OwnerProfileId TEXT NOT NULL,
                    Slug TEXT NOT NULL,
                    Title TEXT NOT NULL,
                    Description TEXT NULL,
                    ThemeConfigJson TEXT NULL,
                    IsPublic INTEGER NOT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    UpdatedAtUtc TEXT NOT NULL,
                    FOREIGN KEY (OwnerProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE UNIQUE INDEX IF NOT EXISTS IX_Blogs_OwnerProfileId_Slug
                ON Blogs (OwnerProfileId, Slug);
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE INDEX IF NOT EXISTS IX_Blogs_OwnerProfileId_UpdatedAtUtc
                ON Blogs (OwnerProfileId, UpdatedAtUtc);
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS BlogPosts (
                    Id TEXT NOT NULL PRIMARY KEY,
                    BlogId TEXT NOT NULL,
                    AuthorProfileId TEXT NOT NULL,
                    Slug TEXT NOT NULL,
                    Title TEXT NOT NULL,
                    Content TEXT NOT NULL,
                    Excerpt TEXT NULL,
                    CoverImageUrl TEXT NULL,
                    TagsJson TEXT NULL,
                    IsPublished INTEGER NOT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    UpdatedAtUtc TEXT NOT NULL,
                    PublishedAtUtc TEXT NULL,
                    FOREIGN KEY (BlogId) REFERENCES Blogs (Id) ON DELETE CASCADE,
                    FOREIGN KEY (AuthorProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE UNIQUE INDEX IF NOT EXISTS IX_BlogPosts_BlogId_Slug
                ON BlogPosts (BlogId, Slug);
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE INDEX IF NOT EXISTS IX_BlogPosts_BlogId_IsPublished_PublishedAtUtc
                ON BlogPosts (BlogId, IsPublished, PublishedAtUtc);
                """, cancellationToken);
            }
            else if (dbContext.Database.IsMySql())
            {
                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `Blogs` (
                    `Id` char(36) NOT NULL,
                    `OwnerProfileId` char(36) NOT NULL,
                    `Slug` varchar(80) NOT NULL,
                    `Title` varchar(160) NOT NULL,
                    `Description` varchar(1000) NULL,
                    `ThemeConfigJson` longtext NULL,
                    `IsPublic` tinyint(1) NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    `UpdatedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`Id`),
                    UNIQUE KEY `IX_Blogs_OwnerProfileId_Slug` (`OwnerProfileId`, `Slug`),
                    KEY `IX_Blogs_OwnerProfileId_UpdatedAtUtc` (`OwnerProfileId`, `UpdatedAtUtc`)
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `BlogPosts` (
                    `Id` char(36) NOT NULL,
                    `BlogId` char(36) NOT NULL,
                    `AuthorProfileId` char(36) NOT NULL,
                    `Slug` varchar(120) NOT NULL,
                    `Title` varchar(220) NOT NULL,
                    `Content` longtext NOT NULL,
                    `Excerpt` varchar(800) NULL,
                    `CoverImageUrl` varchar(2048) NULL,
                    `TagsJson` longtext NULL,
                    `IsPublished` tinyint(1) NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    `UpdatedAtUtc` datetime(6) NOT NULL,
                    `PublishedAtUtc` datetime(6) NULL,
                    PRIMARY KEY (`Id`),
                    UNIQUE KEY `IX_BlogPosts_BlogId_Slug` (`BlogId`, `Slug`),
                    KEY `IX_BlogPosts_BlogId_IsPublished_PublishedAtUtc` (`BlogId`, `IsPublished`, `PublishedAtUtc`)
                );
                """, cancellationToken);
            }

            schemaInitialized = true;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
        {
            schemaInitialized = true;
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }
}
