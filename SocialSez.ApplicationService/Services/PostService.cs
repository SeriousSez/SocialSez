using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;
using System.Text.RegularExpressions;

namespace SocialSez.ApplicationService.Services;

public class PostService(SocialSezContext dbContext) : IPostService
{
    private const string LikeReactionType = "Like";
    private static readonly Regex HashtagRegex = new(@"(?<![\p{L}\p{N}_])#(?<tag>[\p{L}\p{N}_]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly HashSet<string> AllowedReactionTypes = new(StringComparer.Ordinal)
    {
        "Like", "Love", "Laugh", "Wow", "Sad", "Angry"
    };
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool postSchemaInitialized;

    public async Task<PostDto> CreateAsync(CreatePostRequest request, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var author = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == request.AuthorId, cancellationToken);
        if (author is null)
        {
            throw new InvalidOperationException("Author does not exist.");
        }

        var content = request.Content?.Trim() ?? string.Empty;
        var imageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) ? null : request.ImageUrl.Trim();

        if (string.IsNullOrWhiteSpace(content) && string.IsNullOrWhiteSpace(imageUrl))
        {
            throw new ArgumentException("Post content or image is required.", nameof(request));
        }

        var post = new Post
        {
            Id = Guid.NewGuid(),
            AuthorId = request.AuthorId,
            Content = content,
            ImageUrl = imageUrl,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.Posts.Add(post);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new PostDto(
            post.Id,
            post.AuthorId,
            author.Handle,
            author.ImageUrl,
            post.Content,
            post.ImageUrl,
            post.CreatedAtUtc,
            0,
            false,
            null,
            Array.Empty<ReactionSummaryDto>(),
            Array.Empty<CommentDto>());
    }

    public async Task<PostDto?> AddCommentAsync(Guid postId, CreateCommentRequest request, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var authorExists = await dbContext.UserProfiles.AnyAsync(x => x.Id == request.AuthorId, cancellationToken);
        if (!authorExists)
        {
            throw new InvalidOperationException("Comment author does not exist.");
        }

        var content = request.Content.Trim();
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException("Comment content is required.", nameof(request));
        }

        if (request.ParentCommentId.HasValue)
        {
            var parentExists = post.Comments.Any(comment => comment.Id == request.ParentCommentId.Value);
            if (!parentExists)
            {
                throw new ArgumentException("Parent comment was not found on this post.", nameof(request));
            }
        }

        var comment = new Comment
        {
            Id = Guid.NewGuid(),
            PostId = postId,
            AuthorId = request.AuthorId,
            ParentCommentId = request.ParentCommentId,
            Content = content,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.Comments.Add(comment);
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToPostDto(post, request.AuthorId);
    }

    public async Task<PostDto?> UpdateCommentAsync(Guid postId, Guid commentId, Guid profileId, UpdateCommentRequest request, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var comment = post.Comments.FirstOrDefault(x => x.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        if (comment.AuthorId != profileId)
        {
            throw new UnauthorizedAccessException("You can only edit your own comments.");
        }

        var content = request.Content?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException("Comment content is required.", nameof(request));
        }

        comment.Content = content;
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToPostDto(post, profileId);
    }

    public async Task<PostDto?> DeleteCommentAsync(Guid postId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var comment = post.Comments.FirstOrDefault(x => x.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        var canDelete = comment.AuthorId == profileId || post.AuthorId == profileId;
        if (!canDelete)
        {
            throw new UnauthorizedAccessException("Only the comment author or post author can delete this comment.");
        }

        var commentIdsToDelete = new HashSet<Guid> { commentId };
        var queue = new Queue<Guid>();
        queue.Enqueue(commentId);

        while (queue.Count > 0)
        {
            var currentId = queue.Dequeue();
            var directReplies = post.Comments
                .Where(item => item.ParentCommentId == currentId)
                .Select(item => item.Id)
                .Where(id => commentIdsToDelete.Add(id))
                .ToArray();

            foreach (var replyId in directReplies)
            {
                queue.Enqueue(replyId);
            }
        }

        var commentsToDelete = post.Comments
            .Where(item => commentIdsToDelete.Contains(item.Id))
            .ToArray();

        dbContext.Comments.RemoveRange(commentsToDelete);
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToPostDto(post, profileId);
    }

    public async Task<PostDto?> SetCommentReactionAsync(Guid postId, Guid commentId, Guid profileId, SetReactionRequest request, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var normalizedType = NormalizeReactionType(request.Type);
        if (!AllowedReactionTypes.Contains(normalizedType))
        {
            throw new ArgumentException("Unsupported reaction type.", nameof(request));
        }

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var comment = post.Comments.FirstOrDefault(x => x.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        var existingReaction = comment.Reactions.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingReaction is null)
        {
            comment.Reactions.Add(new CommentReaction
            {
                CommentId = comment.Id,
                ProfileId = profileId,
                Type = normalizedType,
                CreatedAtUtc = DateTime.UtcNow
            });
        }
        else
        {
            existingReaction.Type = normalizedType;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToPostDto(post, profileId);
    }

    public async Task<PostDto?> ClearCommentReactionAsync(Guid postId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var comment = post.Comments.FirstOrDefault(x => x.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        var existingReaction = comment.Reactions.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingReaction is not null)
        {
            dbContext.CommentReactions.Remove(existingReaction);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return MapToPostDto(post, profileId);
    }

    public async Task<PostDto?> UpdateAsync(Guid postId, Guid profileId, UpdatePostRequest request, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        if (post.AuthorId != profileId)
        {
            throw new UnauthorizedAccessException("You can only update your own posts.");
        }

        var content = request.Content?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content) && string.IsNullOrWhiteSpace(post.ImageUrl))
        {
            throw new ArgumentException("Post content is required when no image is attached.", nameof(request));
        }

        post.Content = content;
        await dbContext.SaveChangesAsync(cancellationToken);

        var hydratedPost = await dbContext.Posts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        return hydratedPost is null ? null : MapToPostDto(hydratedPost, profileId);
    }

    public async Task<bool> DeleteAsync(Guid postId, Guid profileId, CancellationToken cancellationToken = default)
    {
        var post = await dbContext.Posts.FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);
        if (post is null)
        {
            return false;
        }

        if (post.AuthorId != profileId)
        {
            throw new UnauthorizedAccessException("You can only delete your own posts.");
        }

        dbContext.Posts.Remove(post);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<PostDto?> ToggleLikeAsync(Guid postId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var existingReaction = post.Reactions.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingReaction is not null && string.Equals(existingReaction.Type, LikeReactionType, StringComparison.OrdinalIgnoreCase))
        {
            dbContext.PostReactions.Remove(existingReaction);
        }
        else if (existingReaction is null)
        {
            post.Reactions.Add(new PostReaction
            {
                PostId = post.Id,
                ProfileId = profileId,
                Type = LikeReactionType,
                CreatedAtUtc = DateTime.UtcNow
            });
        }
        else
        {
            existingReaction.Type = LikeReactionType;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToPostDto(post, profileId);
    }

    public async Task<PostDto?> SetReactionAsync(Guid postId, Guid profileId, SetReactionRequest request, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var normalizedType = NormalizeReactionType(request.Type);
        if (!AllowedReactionTypes.Contains(normalizedType))
        {
            throw new ArgumentException("Unsupported reaction type.", nameof(request));
        }

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var existingReaction = post.Reactions.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingReaction is null)
        {
            post.Reactions.Add(new PostReaction
            {
                PostId = post.Id,
                ProfileId = profileId,
                Type = normalizedType,
                CreatedAtUtc = DateTime.UtcNow
            });
        }
        else
        {
            existingReaction.Type = normalizedType;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToPostDto(post, profileId);
    }

    public async Task<PostDto?> ClearReactionAsync(Guid postId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var existingReaction = post.Reactions.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingReaction is not null)
        {
            dbContext.PostReactions.Remove(existingReaction);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return MapToPostDto(post, profileId);
    }

    public async Task<IReadOnlyCollection<PostDto>> GetFeedAsync(Guid profileId, int take = 25, FeedMode mode = FeedMode.ForYou, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        take = Math.Clamp(take, 1, 100);
        var nowUtc = DateTime.UtcNow;

        var followedIds = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);
        var followedSet = followedIds.ToHashSet();

        if (mode == FeedMode.Following)
        {
            var followingPosts = await dbContext.Posts
                .AsNoTracking()
                .Include(x => x.Author)
                .Include(x => x.Comments)
                    .ThenInclude(x => x.Author)
                .Include(x => x.Comments)
                    .ThenInclude(x => x.Reactions)
                .Include(x => x.Reactions)
                .Where(x => followedIds.Contains(x.AuthorId))
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(take)
                .ToArrayAsync(cancellationToken);

            return followingPosts
                .Select(post => MapToPostDto(post, profileId))
                .ToArray();
        }

        var authorAffinity = new Dictionary<Guid, double>();
        var hashtagAffinity = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);

        var reactionSignals = await dbContext.PostReactions
            .AsNoTracking()
            .Where(x => x.ProfileId == profileId)
            .Join(
                dbContext.Posts.AsNoTracking(),
                reaction => reaction.PostId,
                post => post.Id,
                (reaction, post) => new { post.AuthorId, post.Content, reaction.CreatedAtUtc })
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(800)
            .ToArrayAsync(cancellationToken);

        foreach (var signal in reactionSignals)
        {
            authorAffinity[signal.AuthorId] = authorAffinity.TryGetValue(signal.AuthorId, out var score)
                ? score + 3.0
                : 3.0;

            foreach (var tag in ExtractHashtags(signal.Content))
            {
                hashtagAffinity[tag] = hashtagAffinity.TryGetValue(tag, out var tagScore)
                    ? tagScore + 2.0
                    : 2.0;
            }
        }

        var commentSignals = await dbContext.Comments
            .AsNoTracking()
            .Where(x => x.AuthorId == profileId)
            .Join(
                dbContext.Posts.AsNoTracking(),
                comment => comment.PostId,
                post => post.Id,
                (comment, post) => new { post.AuthorId, post.Content, comment.CreatedAtUtc })
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(500)
            .ToArrayAsync(cancellationToken);

        foreach (var signal in commentSignals)
        {
            authorAffinity[signal.AuthorId] = authorAffinity.TryGetValue(signal.AuthorId, out var score)
                ? score + 4.5
                : 4.5;

            foreach (var tag in ExtractHashtags(signal.Content))
            {
                hashtagAffinity[tag] = hashtagAffinity.TryGetValue(tag, out var tagScore)
                    ? tagScore + 2.8
                    : 2.8;
            }
        }

        var candidates = await dbContext.Posts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .Where(x => followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(Math.Clamp(take * 40, 120, 2000))
            .ToArrayAsync(cancellationToken);

        var ranked = candidates
            .Select(post =>
            {
                var authorScore = authorAffinity.TryGetValue(post.AuthorId, out var affinity) ? affinity : 0d;

                var tags = ExtractHashtags(post.Content);
                var hashtagScore = tags.Sum(tag => hashtagAffinity.TryGetValue(tag, out var score) ? score : 0d);

                var engagementScore = Math.Min(6d, (post.Reactions.Count * 0.2) + (post.Comments.Count * 0.3));
                var followingBoost = followedSet.Contains(post.AuthorId) ? 1.0 : 0d;

                var ageDays = Math.Max(0, (nowUtc - post.CreatedAtUtc).TotalDays);
                var recencyScore = Math.Max(0d, 4.5 - (ageDays * 0.35));

                var totalScore = (authorScore * 0.45) + (hashtagScore * 0.35) + engagementScore + followingBoost + recencyScore;

                return new
                {
                    Post = post,
                    Score = totalScore
                };
            })
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => x.Post.CreatedAtUtc)
            .Take(take)
            .Select(x => x.Post)
            .ToArray();

        return ranked
            .Select(post => MapToPostDto(post, profileId))
            .ToArray();
    }

    public async Task<IReadOnlyCollection<PostDto>> SearchPostsAsync(Guid profileId, string query, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var normalizedQuery = query.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedQuery))
        {
            return Array.Empty<PostDto>();
        }

        take = Math.Clamp(take, 1, 100);

        var followedIds = await dbContext.Follows
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);

        var posts = await dbContext.Posts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .Where(x =>
                (followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate)
                &&
                ((!string.IsNullOrWhiteSpace(x.Content) && x.Content.ToLower().Contains(normalizedQuery)) ||
                x.Author.Handle.Contains(normalizedQuery)))
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        return posts
            .Select(post => MapToPostDto(post, profileId))
            .ToArray();
    }

    public async Task<IReadOnlyCollection<HashtagSearchResultDto>> GetTrendingHashtagsAsync(int take = 10, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 100);
        var sinceUtc = DateTime.UtcNow.AddDays(-7);

        var recentCandidates = await dbContext.Posts
            .AsNoTracking()
            .Where(x => !string.IsNullOrWhiteSpace(x.Content) && x.Content.Contains('#') && x.CreatedAtUtc >= sinceUtc)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(2000)
            .Select(x => x.Content)
            .ToArrayAsync(cancellationToken);

        var candidates = recentCandidates.Length > 0
            ? recentCandidates
            : await dbContext.Posts
                .AsNoTracking()
                .Where(x => !string.IsNullOrWhiteSpace(x.Content) && x.Content.Contains('#'))
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(2000)
                .Select(x => x.Content)
                .ToArrayAsync(cancellationToken);

        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (var content in candidates)
        {
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            var distinctTagsInPost = HashtagRegex.Matches(content)
                .Select(x => x.Groups["tag"].Value)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            foreach (var tag in distinctTagsInPost)
            {
                counts[tag] = counts.TryGetValue(tag, out var current) ? current + 1 : 1;
            }
        }

        return counts
            .Select(x => new HashtagSearchResultDto(x.Key, x.Value))
            .OrderByDescending(x => x.Count)
            .ThenBy(x => x.Tag)
            .Take(take)
            .ToArray();
    }

    public async Task<IReadOnlyCollection<HashtagSearchResultDto>> SearchHashtagsAsync(string query, int take = 20, CancellationToken cancellationToken = default)
    {
        var normalizedQuery = NormalizeHashtag(query);
        if (string.IsNullOrWhiteSpace(normalizedQuery))
        {
            return Array.Empty<HashtagSearchResultDto>();
        }

        take = Math.Clamp(take, 1, 100);

        var candidates = await dbContext.Posts
            .AsNoTracking()
            .Where(x => !string.IsNullOrWhiteSpace(x.Content) && x.Content.Contains('#'))
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(1000)
            .Select(x => x.Content)
            .ToArrayAsync(cancellationToken);

        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (var content in candidates)
        {
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            var distinctTagsInPost = HashtagRegex.Matches(content)
                .Select(x => x.Groups["tag"].Value)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            foreach (var tag in distinctTagsInPost)
            {
                if (!tag.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                counts[tag] = counts.TryGetValue(tag, out var current) ? current + 1 : 1;
            }
        }

        return counts
            .Select(x => new HashtagSearchResultDto(x.Key, x.Value))
            .OrderByDescending(x => x.Count)
            .ThenBy(x => x.Tag)
            .Take(take)
            .ToArray();
    }

    public async Task<IReadOnlyCollection<PostDto>> GetByHashtagAsync(Guid profileId, string hashtag, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var normalizedHashtag = NormalizeHashtag(hashtag);
        if (string.IsNullOrEmpty(normalizedHashtag))
        {
            throw new ArgumentException("Hashtag is required.", nameof(hashtag));
        }

        take = Math.Clamp(take, 1, 100);
        var needle = $"#{normalizedHashtag.ToLowerInvariant()}";

        var followedIds = await dbContext.Follows
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);

        var candidates = await dbContext.Posts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .Where(x => (followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate)
                && !string.IsNullOrWhiteSpace(x.Content)
                && x.Content.ToLower().Contains(needle))
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take * 5)
            .ToArrayAsync(cancellationToken);

        var hashtagRegex = BuildHashtagRegex(normalizedHashtag);

        return candidates
            .Where(post => hashtagRegex.IsMatch(post.Content))
            .Take(take)
            .Select(post => MapToPostDto(post, profileId))
            .ToArray();
    }

    public async Task<IReadOnlyCollection<PostDto>> GetByAuthorHandleAsync(Guid profileId, string handle, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var normalizedHandle = handle.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedHandle))
        {
            return Array.Empty<PostDto>();
        }

        take = Math.Clamp(take, 1, 100);

        var followedIds = await dbContext.Follows
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);

        var posts = await dbContext.Posts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .Where(x => x.Author.Handle == normalizedHandle && (followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate))
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        return posts
            .Select(post => MapToPostDto(post, profileId))
            .ToArray();
    }

    public async Task<PostDto?> GetPublicByIdAsync(Guid postId, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var post = await dbContext.Posts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        return post is null ? null : MapToPostDto(post, Guid.Empty);
    }

    public async Task<IReadOnlyCollection<PostDto>> GetPublicByAuthorHandleAsync(string handle, Guid? viewerId = null, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsurePostSchemaAsync(cancellationToken);

        var normalizedHandle = handle.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedHandle))
        {
            return Array.Empty<PostDto>();
        }

        take = Math.Clamp(take, 1, 100);

        var author = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Handle == normalizedHandle, cancellationToken);

        if (author is null)
        {
            return Array.Empty<PostDto>();
        }

        var canViewPrivate = false;
        if (viewerId.HasValue)
        {
            canViewPrivate = viewerId.Value == author.Id
                || await dbContext.Follows
                    .AsNoTracking()
                    .AnyAsync(x => x.FollowerId == viewerId.Value && x.FollowedId == author.Id, cancellationToken);
        }

        if (author.IsPrivate && !canViewPrivate)
        {
            return Array.Empty<PostDto>();
        }

        var posts = await dbContext.Posts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Reactions)
            .Include(x => x.Reactions)
            .Where(x => x.AuthorId == author.Id)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        var mapProfileId = viewerId ?? Guid.Empty;
        return posts
            .Select(post => MapToPostDto(post, mapProfileId))
            .ToArray();
    }

    private static PostDto MapToPostDto(Post post, Guid profileId)
    {
        var comments = post.Comments
            .OrderBy(x => x.CreatedAtUtc)
            .Select(x => new CommentDto(
                x.Id,
                x.PostId,
                x.AuthorId,
                x.ParentCommentId,
                x.Author.Handle,
                x.Author.ImageUrl,
                x.Content,
                x.CreatedAtUtc,
                x.Reactions.FirstOrDefault(r => r.ProfileId == profileId)?.Type,
                x.Reactions
                    .GroupBy(r => r.Type)
                    .Select(group => new ReactionSummaryDto(group.Key, group.Count()))
                    .OrderByDescending(r => r.Count)
                    .ThenBy(r => r.Type)
                    .ToArray()))
            .ToArray();

        var reactions = post.Reactions
            .GroupBy(x => x.Type)
            .Select(group => new ReactionSummaryDto(group.Key, group.Count()))
            .OrderByDescending(x => x.Count)
            .ThenBy(x => x.Type)
            .ToArray();

        var myReactionType = post.Reactions
            .FirstOrDefault(x => x.ProfileId == profileId)
            ?.Type;

        var likeCount = post.Reactions.Count(x => string.Equals(x.Type, LikeReactionType, StringComparison.OrdinalIgnoreCase));

        return new PostDto(
            post.Id,
            post.AuthorId,
            post.Author.Handle,
            post.Author.ImageUrl,
            post.Content,
            post.ImageUrl,
            post.CreatedAtUtc,
            likeCount,
            string.Equals(myReactionType, LikeReactionType, StringComparison.OrdinalIgnoreCase),
            myReactionType,
            reactions,
            comments);
    }

    private static string NormalizeReactionType(string? rawType)
    {
        if (string.IsNullOrWhiteSpace(rawType))
        {
            return string.Empty;
        }

        var trimmed = rawType.Trim().ToLowerInvariant();
        return trimmed switch
        {
            "like" => LikeReactionType,
            "love" => "Love",
            "laugh" => "Laugh",
            "wow" => "Wow",
            "sad" => "Sad",
            "angry" => "Angry",
            _ => string.Empty
        };
    }

    private static string NormalizeHashtag(string? rawHashtag)
    {
        if (string.IsNullOrWhiteSpace(rawHashtag))
        {
            return string.Empty;
        }

        var trimmed = rawHashtag.Trim();
        if (trimmed.StartsWith('#'))
        {
            trimmed = trimmed[1..];
        }

        if (trimmed.Length is < 1 or > 64)
        {
            return string.Empty;
        }

        return Regex.IsMatch(trimmed, "^[\\p{L}\\p{N}_]+$", RegexOptions.CultureInvariant)
            ? trimmed
            : string.Empty;
    }

    private static Regex BuildHashtagRegex(string hashtag)
    {
        var escaped = Regex.Escape(hashtag);
        return new Regex($"(?<![\\p{{L}}\\p{{N}}_])#{escaped}(?![\\p{{L}}\\p{{N}}_])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static string[] ExtractHashtags(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || !content.Contains('#'))
        {
            return Array.Empty<string>();
        }

        return HashtagRegex.Matches(content)
            .Select(match => match.Groups["tag"].Value)
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .Select(tag => tag.ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private async Task EnsurePostSchemaAsync(CancellationToken cancellationToken)
    {
        if (postSchemaInitialized || !dbContext.Database.IsSqlite())
        {
            return;
        }

        await SchemaInitLock.WaitAsync(cancellationToken);
        try
        {
            if (postSchemaInitialized)
            {
                return;
            }

            try
            {
                await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE Comments ADD COLUMN ParentCommentId TEXT NULL;", cancellationToken);
            }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
            {
            }

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_Comments_ParentCommentId ON Comments (ParentCommentId);", cancellationToken);
            postSchemaInitialized = true;
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }
}
