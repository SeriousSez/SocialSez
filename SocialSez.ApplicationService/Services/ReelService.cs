using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;
using System.Text.RegularExpressions;

namespace SocialSez.ApplicationService.Services;

public class ReelService(SocialSezContext dbContext) : IReelService
{
    private static readonly Regex HashtagRegex = new(@"(?<![\p{L}\p{N}_])#(?<tag>[\p{L}\p{N}_]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool reelSchemaInitialized;

    public async Task<ReelDto> CreateAsync(CreateReelRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var author = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.AuthorId, cancellationToken);

        if (author is null)
        {
            throw new InvalidOperationException("Author does not exist.");
        }

        var videoUrl = request.VideoUrl?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(videoUrl))
        {
            throw new ArgumentException("Reel video is required.", nameof(request));
        }

        var caption = request.Caption?.Trim();
        if (caption?.Length > 500)
        {
            throw new ArgumentException("Reel caption cannot exceed 500 characters.", nameof(request));
        }

        var durationSeconds = Math.Clamp(request.DurationSeconds, 1, 180);

        var reel = new Reel
        {
            Id = Guid.NewGuid(),
            AuthorId = request.AuthorId,
            Caption = string.IsNullOrWhiteSpace(caption) ? null : caption,
            VideoUrl = videoUrl,
            ThumbnailUrl = string.IsNullOrWhiteSpace(request.ThumbnailUrl) ? null : request.ThumbnailUrl.Trim(),
            DurationSeconds = durationSeconds,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.Reels.Add(reel);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new ReelDto(
            reel.Id,
            reel.AuthorId,
            author.Handle,
            author.ImageUrl,
            reel.Caption,
            reel.VideoUrl,
            reel.ThumbnailUrl,
            reel.DurationSeconds,
            reel.CreatedAtUtc,
            0,
                false,
                Array.Empty<ReelCommentDto>());
    }

    public async Task<bool> DeleteAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels.FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);
        if (reel is null)
        {
            return false;
        }

        if (reel.AuthorId != profileId)
        {
            throw new UnauthorizedAccessException("You can only delete your own reels.");
        }

        dbContext.Reels.Remove(reel);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<ReelDto?> UpdateAsync(Guid reelId, Guid profileId, UpdateReelRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        if (reel.AuthorId != profileId)
        {
            throw new UnauthorizedAccessException("You can only update your own reels.");
        }

        var caption = request.Caption?.Trim();
        if (caption?.Length > 500)
        {
            throw new ArgumentException("Reel caption cannot exceed 500 characters.", nameof(request));
        }

        reel.Caption = string.IsNullOrWhiteSpace(caption) ? null : caption;
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToReelDto(reel, profileId);
    }

    public async Task<ReelDto?> ToggleLikeAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        var existingLike = reel.Likes.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingLike is null)
        {
            reel.Likes.Add(new ReelLike
            {
                ReelId = reelId,
                ProfileId = profileId,
                CreatedAtUtc = DateTime.UtcNow
            });
        }
        else
        {
            dbContext.ReelLikes.Remove(existingLike);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToReelDto(reel, profileId);
    }

    public async Task<ReelDto?> AddCommentAsync(Guid reelId, CreateReelCommentRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        var authorExists = await dbContext.UserProfiles
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.AuthorId, cancellationToken);

        if (!authorExists)
        {
            throw new InvalidOperationException("Author does not exist.");
        }

        var content = request.Content?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException("Comment content is required.", nameof(request));
        }

        if (content.Length > 500)
        {
            throw new ArgumentException("Comment cannot exceed 500 characters.", nameof(request));
        }

        if (request.ParentCommentId.HasValue)
        {
            var parentExists = reel.Comments.Any(comment => comment.Id == request.ParentCommentId.Value);
            if (!parentExists)
            {
                throw new ArgumentException("Parent comment was not found on this reel.", nameof(request));
            }
        }

        dbContext.ReelComments.Add(new ReelComment
        {
            Id = Guid.NewGuid(),
            ReelId = reelId,
            AuthorId = request.AuthorId,
            ParentCommentId = request.ParentCommentId,
            Content = content,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToReelDto(reel, request.AuthorId);
    }

    public async Task<ReelDto?> UpdateCommentAsync(Guid reelId, Guid commentId, Guid profileId, UpdateReelCommentRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        var comment = reel.Comments.FirstOrDefault(item => item.Id == commentId);
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

        if (content.Length > 500)
        {
            throw new ArgumentException("Comment cannot exceed 500 characters.", nameof(request));
        }

        comment.Content = content;
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToReelDto(reel, profileId);
    }

    public async Task<ReelDto?> DeleteCommentAsync(Guid reelId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        var comment = reel.Comments.FirstOrDefault(item => item.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        var canDelete = comment.AuthorId == profileId || reel.AuthorId == profileId;
        if (!canDelete)
        {
            throw new UnauthorizedAccessException("Only the comment author or reel author can delete this comment.");
        }

        var commentIdsToDelete = new HashSet<Guid> { commentId };
        var queue = new Queue<Guid>();
        queue.Enqueue(commentId);

        while (queue.Count > 0)
        {
            var currentId = queue.Dequeue();
            var directReplies = reel.Comments
                .Where(item => item.ParentCommentId == currentId)
                .Select(item => item.Id)
                .Where(id => commentIdsToDelete.Add(id))
                .ToArray();

            foreach (var replyId in directReplies)
            {
                queue.Enqueue(replyId);
            }
        }

        var commentsToDelete = reel.Comments
            .Where(item => commentIdsToDelete.Contains(item.Id))
            .ToArray();

        dbContext.ReelComments.RemoveRange(commentsToDelete);
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToReelDto(reel, profileId);
    }

    public async Task<ReelDto?> ToggleCommentLikeAsync(Guid reelId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        var comment = reel.Comments.FirstOrDefault(item => item.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        var existing = comment.Likes.FirstOrDefault(item => item.ProfileId == profileId);
        if (existing is null)
        {
            comment.Likes.Add(new ReelCommentLike
            {
                ReelCommentId = commentId,
                ProfileId = profileId,
                CreatedAtUtc = DateTime.UtcNow
            });
        }
        else
        {
            dbContext.ReelCommentLikes.Remove(existing);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToReelDto(reel, profileId);
    }

    public async Task<IReadOnlyCollection<ReelDto>> GetFeedAsync(Guid profileId, int take = 25, FeedMode mode = FeedMode.ForYou, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        take = Math.Clamp(take, 1, 100);
        var nowUtc = DateTime.UtcNow;
        var blockedProfileIds = await GetBlockedProfileIdsAsync(profileId, cancellationToken);

        var followedIds = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);
        if (blockedProfileIds.Count > 0)
        {
            followedIds = followedIds
                .Where(id => !blockedProfileIds.Contains(id))
                .ToList();
        }

        var followedSet = followedIds.ToHashSet();

        if (mode == FeedMode.Following)
        {
            var followingReels = await dbContext.Reels
                .AsNoTracking()
                .Include(x => x.Author)
                .Include(x => x.Likes)
                .Include(x => x.Comments)
                    .ThenInclude(comment => comment.Author)
                .Include(x => x.Comments)
                    .ThenInclude(comment => comment.Likes)
                .Where(x => followedIds.Contains(x.AuthorId))
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(take)
                .ToArrayAsync(cancellationToken);

            return followingReels
                .Select(x => MapToReelDto(x, profileId))
                .ToArray();
        }

        var authorAffinity = new Dictionary<Guid, double>();
        var hashtagAffinity = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);

        var likedReels = await dbContext.ReelLikes
            .AsNoTracking()
            .Where(x => x.ProfileId == profileId)
            .Join(
                dbContext.Reels.AsNoTracking(),
                like => like.ReelId,
                reel => reel.Id,
                (like, reel) => new { reel.AuthorId, reel.Caption, like.CreatedAtUtc })
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(800)
            .ToArrayAsync(cancellationToken);

        foreach (var signal in likedReels)
        {
            authorAffinity[signal.AuthorId] = authorAffinity.TryGetValue(signal.AuthorId, out var score)
                ? score + 4.0
                : 4.0;

            foreach (var tag in ExtractHashtags(signal.Caption))
            {
                hashtagAffinity[tag] = hashtagAffinity.TryGetValue(tag, out var tagScore)
                    ? tagScore + 2.2
                    : 2.2;
            }
        }

        var postReactionSignals = await dbContext.PostReactions
            .AsNoTracking()
            .Where(x => x.ProfileId == profileId)
            .Join(
                dbContext.Posts.AsNoTracking(),
                reaction => reaction.PostId,
                post => post.Id,
                (reaction, post) => new { post.AuthorId, post.Content, reaction.CreatedAtUtc })
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(400)
            .ToArrayAsync(cancellationToken);

        foreach (var signal in postReactionSignals)
        {
            authorAffinity[signal.AuthorId] = authorAffinity.TryGetValue(signal.AuthorId, out var score)
                ? score + 1.5
                : 1.5;

            foreach (var tag in ExtractHashtags(signal.Content))
            {
                hashtagAffinity[tag] = hashtagAffinity.TryGetValue(tag, out var tagScore)
                    ? tagScore + 1.4
                    : 1.4;
            }
        }

        var candidates = await dbContext.Reels
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .Where(x => (followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate)
                && !blockedProfileIds.Contains(x.AuthorId))
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(Math.Clamp(take * 35, 100, 1400))
            .ToArrayAsync(cancellationToken);

        var ranked = candidates
            .Select(reel =>
            {
                var authorScore = authorAffinity.TryGetValue(reel.AuthorId, out var affinity) ? affinity : 0d;
                var hashtagScore = ExtractHashtags(reel.Caption)
                    .Sum(tag => hashtagAffinity.TryGetValue(tag, out var score) ? score : 0d);
                var socialScore = Math.Min(5.0, reel.Likes.Count * 0.3);
                var followingBoost = followedSet.Contains(reel.AuthorId) ? 1.0 : 0d;
                var ageDays = Math.Max(0, (nowUtc - reel.CreatedAtUtc).TotalDays);
                var recencyScore = Math.Max(0d, 4.2 - (ageDays * 0.33));
                var totalScore = (authorScore * 0.5) + (hashtagScore * 0.3) + socialScore + followingBoost + recencyScore;

                return new
                {
                    Reel = reel,
                    Score = totalScore
                };
            })
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => x.Reel.CreatedAtUtc)
            .Take(take)
            .Select(x => x.Reel)
            .ToArray();

        return ranked
            .Select(x => MapToReelDto(x, profileId))
            .ToArray();
    }

    public async Task<IReadOnlyCollection<ReelDto>> GetByAuthorHandleAsync(Guid profileId, string handle, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var normalizedHandle = handle.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedHandle))
        {
            return Array.Empty<ReelDto>();
        }

        take = Math.Clamp(take, 1, 100);
        var blockedProfileIds = await GetBlockedProfileIdsAsync(profileId, cancellationToken);

        var followedIds = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);
        if (blockedProfileIds.Count > 0)
        {
            followedIds = followedIds
                .Where(id => !blockedProfileIds.Contains(id))
                .ToList();
        }

        var reels = await dbContext.Reels
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .Where(x => x.Author.Handle == normalizedHandle
                && (followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate)
                && !blockedProfileIds.Contains(x.AuthorId))
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        return reels
            .Select(reel => MapToReelDto(reel, profileId))
            .ToArray();
    }

    public async Task<ReelDto?> GetPublicByIdAsync(Guid reelId, Guid? viewerId = null, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        if (viewerId.HasValue)
        {
            var blockedProfileIds = await GetBlockedProfileIdsAsync(viewerId.Value, cancellationToken);
            if (blockedProfileIds.Contains(reel.AuthorId))
            {
                return null;
            }
        }

        return MapToReelDto(reel, viewerId ?? Guid.Empty);
    }

    public async Task<IReadOnlyCollection<ReelDto>> GetPublicByAuthorHandleAsync(string handle, Guid? viewerId = null, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var normalizedHandle = handle.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedHandle))
        {
            return Array.Empty<ReelDto>();
        }

        take = Math.Clamp(take, 1, 100);

        var author = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Handle == normalizedHandle, cancellationToken);

        if (author is null)
        {
            return Array.Empty<ReelDto>();
        }

        if (viewerId.HasValue)
        {
            var blockedProfileIds = await GetBlockedProfileIdsAsync(viewerId.Value, cancellationToken);
            if (blockedProfileIds.Contains(author.Id))
            {
                return Array.Empty<ReelDto>();
            }
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
            return Array.Empty<ReelDto>();
        }

        var reels = await dbContext.Reels
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .Where(x => x.AuthorId == author.Id)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        var mapProfileId = viewerId ?? Guid.Empty;
        return reels
            .Select(reel => MapToReelDto(reel, mapProfileId))
            .ToArray();
    }

    private async Task<HashSet<Guid>> GetBlockedProfileIdsAsync(Guid viewerId, CancellationToken cancellationToken)
    {
        var blockedByViewer = await dbContext.UserBlocks
            .AsNoTracking()
            .Where(x => x.BlockerId == viewerId)
            .Select(x => x.BlockedId)
            .ToListAsync(cancellationToken);

        var blockingViewer = await dbContext.UserBlocks
            .AsNoTracking()
            .Where(x => x.BlockedId == viewerId)
            .Select(x => x.BlockerId)
            .ToListAsync(cancellationToken);

        return blockedByViewer
            .Concat(blockingViewer)
            .ToHashSet();
    }

    private static ReelDto MapToReelDto(Reel reel, Guid profileId)
    {
        return new ReelDto(
            reel.Id,
            reel.AuthorId,
            reel.Author?.Handle ?? "unknown",
            reel.Author?.ImageUrl,
            reel.Caption,
            reel.VideoUrl,
            reel.ThumbnailUrl,
            reel.DurationSeconds,
            reel.CreatedAtUtc,
            reel.Likes.Count,
            reel.Likes.Any(x => x.ProfileId == profileId),
            reel.Comments
                .OrderBy(comment => comment.CreatedAtUtc)
                .Select(comment => new ReelCommentDto(
                    comment.Id,
                    comment.ReelId,
                    comment.AuthorId,
                    comment.ParentCommentId,
                    comment.Author?.Handle ?? "deleted-user",
                    comment.Author?.ImageUrl,
                    comment.Content,
                    comment.CreatedAtUtc,
                    comment.Likes.Count,
                    comment.Likes.Any(x => x.ProfileId == profileId)))
                .ToArray());
    }

    private static string[] ExtractHashtags(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || !text.Contains('#'))
        {
            return Array.Empty<string>();
        }

        return HashtagRegex.Matches(text)
            .Select(match => match.Groups["tag"].Value)
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .Select(tag => tag.ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private async Task EnsureReelSchemaAsync(CancellationToken cancellationToken)
    {
        if (reelSchemaInitialized || !dbContext.Database.IsSqlite())
        {
            return;
        }

        await SchemaInitLock.WaitAsync(cancellationToken);
        try
        {
            if (reelSchemaInitialized)
            {
                return;
            }

            try
            {
                await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE ReelComments ADD COLUMN ParentCommentId TEXT NULL;", cancellationToken);
            }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
            {
            }

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_ReelComments_ParentCommentId ON ReelComments (ParentCommentId);", cancellationToken);
            reelSchemaInitialized = true;
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }
}
