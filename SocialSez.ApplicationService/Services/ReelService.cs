using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;
using System.Text.RegularExpressions;

namespace SocialSez.ApplicationService.Services;

public class ReelService(SocialSezContext dbContext, ICustomFeedService customFeedService) : IReelService
{
    private static readonly Regex HashtagRegex = new(@"(?<![\p{L}\p{N}_])#(?<tag>[\p{L}\p{N}_]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private const string VariantA = "A";
    private const string VariantB = "B";

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

        var scheduledPublishAtUtc = request.ScheduledPublishAtUtc?.ToUniversalTime();
        if (scheduledPublishAtUtc.HasValue && scheduledPublishAtUtc.Value <= DateTime.UtcNow)
        {
            scheduledPublishAtUtc = null;
        }

        var saveAsDraft = request.SaveAsDraft || scheduledPublishAtUtc.HasValue;
        var shouldPublishNow = !saveAsDraft;
        var nowUtc = DateTime.UtcNow;

        var durationSeconds = Math.Clamp(request.DurationSeconds, 1, 180);

        var reel = new Reel
        {
            Id = Guid.NewGuid(),
            AuthorId = request.AuthorId,
            Caption = string.IsNullOrWhiteSpace(caption) ? null : caption,
            VideoUrl = videoUrl,
            ThumbnailUrl = string.IsNullOrWhiteSpace(request.ThumbnailUrl) ? null : request.ThumbnailUrl.Trim(),
            IsSensitive = request.IsSensitive,
            IsDraft = !shouldPublishNow,
            ScheduledPublishAtUtc = scheduledPublishAtUtc,
            PublishedAtUtc = shouldPublishNow ? nowUtc : null,
            DurationSeconds = durationSeconds,
            CreatedAtUtc = nowUtc
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
            reel.IsSensitive,
            reel.DurationSeconds,
            reel.CreatedAtUtc,
            0,
                false,
                Array.Empty<ReelCommentDto>(),
                0,
                0,
                0,
                reel.IsDraft,
                reel.ScheduledPublishAtUtc,
                reel.PublishedAtUtc);
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
        var shouldNotifyLike = false;

        if (existingLike is null)
        {
            reel.Likes.Add(new ReelLike
            {
                ReelId = reelId,
                ProfileId = profileId,
                CreatedAtUtc = DateTime.UtcNow
            });

            shouldNotifyLike = true;
        }
        else
        {
            dbContext.ReelLikes.Remove(existingLike);
        }

        if (shouldNotifyLike && reel.AuthorId != profileId)
        {
            var actorHandle = await dbContext.UserProfiles
                .AsNoTracking()
                .Where(x => x.Id == profileId)
                .Select(x => x.Handle)
                .FirstOrDefaultAsync(cancellationToken);

            if (!string.IsNullOrWhiteSpace(actorHandle))
            {
                dbContext.Notifications.Add(new Notification
                {
                    Id = Guid.NewGuid(),
                    RecipientId = reel.AuthorId,
                    ActorId = profileId,
                    Type = "ReelLike",
                    Message = $"@{actorHandle} liked your reel.",
                    ReferenceId = reel.Id.ToString(),
                    IsRead = false,
                    CreatedAtUtc = DateTime.UtcNow
                });
            }
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

        var authorHandle = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => x.Id == request.AuthorId)
            .Select(x => x.Handle)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(authorHandle))
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

        if (reel.AuthorId != request.AuthorId)
        {
            dbContext.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                RecipientId = reel.AuthorId,
                ActorId = request.AuthorId,
                Type = "ReelComment",
                Message = $"@{authorHandle} commented on your reel.",
                ReferenceId = reel.Id.ToString(),
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

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

    public async Task<ReelPlaybackDto?> TrackPlaybackAsync(Guid reelId, Guid profileId, TrackReelPlaybackRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        var nowUtc = DateTime.UtcNow;
        var boundedPosition = Math.Clamp(request.LastPositionSeconds, 0, Math.Max(1, reel.DurationSeconds));
        var boundedWatched = Math.Clamp(request.WatchedSeconds, 0, 600);

        var playback = await dbContext.ReelPlaybacks
            .FirstOrDefaultAsync(x => x.ReelId == reelId && x.ViewerId == profileId, cancellationToken);

        var activeTest = await dbContext.ReelAbTests
            .FirstOrDefaultAsync(x => x.ReelId == reelId && x.IsActive, cancellationToken);

        var assignedVariant = activeTest is null ? null : ResolveVariantKey(reelId, profileId);

        if (playback is null)
        {
            playback = new ReelPlayback
            {
                ReelId = reelId,
                ViewerId = profileId,
                LastPositionSeconds = boundedPosition,
                TotalWatchedSeconds = boundedWatched,
                IsCompleted = request.IsCompleted,
                FirstViewedAtUtc = nowUtc,
                LastViewedAtUtc = nowUtc,
                VariantKey = assignedVariant
            };

            dbContext.ReelPlaybacks.Add(playback);

            if (activeTest is not null)
            {
                if (assignedVariant == VariantA)
                {
                    activeTest.VariantAImpressions += 1;
                    activeTest.VariantAViews += 1;
                    activeTest.VariantAWatchSeconds += boundedWatched;
                }
                else
                {
                    activeTest.VariantBImpressions += 1;
                    activeTest.VariantBViews += 1;
                    activeTest.VariantBWatchSeconds += boundedWatched;
                }

                activeTest.UpdatedAtUtc = nowUtc;
            }
        }
        else
        {
            var wasCompleted = playback.IsCompleted;
            var hadWatchData = playback.TotalWatchedSeconds > 0;

            playback.LastPositionSeconds = boundedPosition;
            playback.TotalWatchedSeconds += boundedWatched;
            playback.IsCompleted = playback.IsCompleted || request.IsCompleted;
            playback.LastViewedAtUtc = nowUtc;

            if (string.IsNullOrWhiteSpace(playback.VariantKey) && assignedVariant is not null)
            {
                playback.VariantKey = assignedVariant;
            }

            if (activeTest is not null)
            {
                var variant = playback.VariantKey ?? assignedVariant ?? VariantB;
                if (variant == VariantA)
                {
                    if (!hadWatchData && boundedWatched > 0)
                    {
                        activeTest.VariantAViews += 1;
                    }

                    activeTest.VariantAWatchSeconds += boundedWatched;
                }
                else
                {
                    if (!hadWatchData && boundedWatched > 0)
                    {
                        activeTest.VariantBViews += 1;
                    }

                    activeTest.VariantBWatchSeconds += boundedWatched;
                }

                if (!wasCompleted && playback.IsCompleted)
                {
                    activeTest.UpdatedAtUtc = nowUtc;
                }
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return new ReelPlaybackDto(
            playback.ReelId,
            playback.LastPositionSeconds,
            playback.TotalWatchedSeconds,
            playback.IsCompleted,
            playback.LastViewedAtUtc);
    }

    public async Task<CreatorAnalyticsSummaryDto> GetCreatorAnalyticsAsync(Guid profileId, int days = 7, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var normalizedDays = Math.Clamp(days, 1, 90);
        var sinceUtc = DateTime.UtcNow.AddDays(-normalizedDays);

        var reels = await dbContext.Reels
            .AsNoTracking()
            .Where(x => x.AuthorId == profileId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(120)
            .ToArrayAsync(cancellationToken);

        var reelIds = reels.Select(x => x.Id).ToArray();

        var playbacks = await dbContext.ReelPlaybacks
            .AsNoTracking()
            .Where(x => reelIds.Contains(x.ReelId) && x.LastViewedAtUtc >= sinceUtc)
            .ToArrayAsync(cancellationToken);

        var saveCounts = await dbContext.SavedItems
            .AsNoTracking()
            .Where(x => x.ReelId.HasValue && reelIds.Contains(x.ReelId.Value) && x.SavedAtUtc >= sinceUtc)
            .GroupBy(x => x.ReelId!.Value)
            .Select(group => new { ReelId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(x => x.ReelId, x => x.Count, cancellationToken);

        var testByReelId = await dbContext.ReelAbTests
            .AsNoTracking()
            .Where(x => reelIds.Contains(x.ReelId))
            .ToDictionaryAsync(x => x.ReelId, x => x, cancellationToken);

        var followerGrowth = await dbContext.Follows
            .AsNoTracking()
            .CountAsync(x => x.FollowedId == profileId && x.CreatedAtUtc >= sinceUtc, cancellationToken);

        var reelItems = reels
            .Select(reel =>
            {
                var reelPlaybacks = playbacks.Where(x => x.ReelId == reel.Id).ToArray();
                var views = reelPlaybacks.Length;
                var totalWatchSeconds = reelPlaybacks.Sum(x => x.TotalWatchedSeconds);
                var avgWatchSeconds = views > 0 ? totalWatchSeconds / views : 0;
                var saves = saveCounts.GetValueOrDefault(reel.Id, 0);

                ReelAbTestDto? mappedTest = null;
                if (testByReelId.TryGetValue(reel.Id, out var test))
                {
                    mappedTest = MapAbTest(test);
                }

                return new CreatorReelAnalyticsItemDto(
                    reel.Id,
                    reel.Caption,
                    reel.CreatedAtUtc,
                    views,
                    totalWatchSeconds,
                    avgWatchSeconds,
                    saves,
                    mappedTest);
            })
            .ToArray();

        return new CreatorAnalyticsSummaryDto(
            normalizedDays,
            reelItems.Sum(x => x.Views),
            reelItems.Sum(x => x.TotalWatchSeconds),
            reelItems.Sum(x => x.Saves),
            followerGrowth,
            reelItems);
    }

    public async Task<ReelAbTestDto?> ConfigureAbTestAsync(Guid reelId, Guid profileId, CreateReelAbTestRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var reel = await dbContext.Reels
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == reelId, cancellationToken);

        if (reel is null)
        {
            return null;
        }

        if (reel.AuthorId != profileId)
        {
            throw new UnauthorizedAccessException("You can only configure tests for your own reels.");
        }

        var variantATitle = (request.VariantATitle ?? string.Empty).Trim();
        var variantBTitle = (request.VariantBTitle ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(variantATitle) || string.IsNullOrWhiteSpace(variantBTitle))
        {
            throw new ArgumentException("Both variant titles are required.", nameof(request));
        }

        if (variantATitle.Length > 220 || variantBTitle.Length > 220)
        {
            throw new ArgumentException("Variant titles cannot exceed 220 characters.", nameof(request));
        }

        var nowUtc = DateTime.UtcNow;
        var existing = await dbContext.ReelAbTests.FirstOrDefaultAsync(x => x.ReelId == reelId, cancellationToken);
        if (existing is null)
        {
            existing = new ReelAbTest
            {
                ReelId = reelId,
                OwnerId = profileId,
                CreatedAtUtc = nowUtc
            };

            dbContext.ReelAbTests.Add(existing);
        }

        existing.OwnerId = profileId;
        existing.VariantATitle = variantATitle;
        existing.VariantAThumbnailUrl = NormalizeOptionalUrl(request.VariantAThumbnailUrl);
        existing.VariantBTitle = variantBTitle;
        existing.VariantBThumbnailUrl = NormalizeOptionalUrl(request.VariantBThumbnailUrl);
        existing.IsActive = true;
        existing.WinningVariantKey = null;
        existing.UpdatedAtUtc = nowUtc;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapAbTest(existing);
    }

    public async Task<ReelAbTestDto?> DisableAbTestAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);

        var existing = await dbContext.ReelAbTests.FirstOrDefaultAsync(x => x.ReelId == reelId, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        if (existing.OwnerId != profileId)
        {
            throw new UnauthorizedAccessException("You can only disable tests for your own reels.");
        }

        existing.IsActive = false;
        existing.WinningVariantKey = ResolveWinningVariant(existing);
        existing.UpdatedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapAbTest(existing);
    }

    public async Task<IReadOnlyCollection<ReelDto>> GetDraftsAsync(Guid profileId, int take = 50, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);
        await PublishDueReelsAsync(cancellationToken);

        take = Math.Clamp(take, 1, 100);
        var drafts = await dbContext.Reels
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .Where(x => x.AuthorId == profileId && x.IsDraft)
            .OrderByDescending(x => x.ScheduledPublishAtUtc ?? x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        return drafts
            .Select(reel => MapToReelDto(reel, profileId))
            .ToArray();
    }

    public async Task<IReadOnlyCollection<ReelDto>> GetFeedAsync(Guid profileId, int take = 25, FeedMode mode = FeedMode.ForYou, Guid? customFeedId = null, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);
        await PublishDueReelsAsync(cancellationToken);

        take = Math.Clamp(take, 1, 100);
        var nowUtc = DateTime.UtcNow;
        var blockedProfileIds = await GetBlockedProfileIdsAsync(profileId, cancellationToken);
        var customFeed = customFeedId.HasValue
            ? await customFeedService.GetByIdAsync(profileId, customFeedId.Value, cancellationToken)
            : null;

        if (customFeedId.HasValue && customFeed is null)
        {
            throw new InvalidOperationException("Custom feed not found.");
        }

        var (customFeedAuthorHandles, customFeedExcludedAuthorHandles) = customFeed is null
            ? (new HashSet<string>(StringComparer.Ordinal), new HashSet<string>(StringComparer.Ordinal))
            : CustomFeedMatcher.SplitHandleRules(customFeed.AuthorHandles);
        var customFeedHashtags = customFeed is null
            ? new HashSet<string>(StringComparer.Ordinal)
            : customFeed.Hashtags.ToHashSet(StringComparer.Ordinal);

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

        Console.WriteLine("test");

        if (mode == FeedMode.Following)
        {
            var followingLoadTake = customFeed is null ? take : Math.Clamp(take * 8, take, 400);
            var followingReels = await dbContext.Reels
                .AsNoTracking()
                .Include(x => x.Author)
                .Include(x => x.Likes)
                .Include(x => x.Comments)
                    .ThenInclude(comment => comment.Author)
                .Include(x => x.Comments)
                    .ThenInclude(comment => comment.Likes)
                .Where(x => followedIds.Contains(x.AuthorId)
                    && !blockedProfileIds.Contains(x.AuthorId)
                    && !x.IsDraft)
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(followingLoadTake)
                .ToArrayAsync(cancellationToken);

            var filteredFollowingReels = customFeed is null
                ? followingReels
                : followingReels
                    .Where(reel => CustomFeedMatcher.Matches(reel.Author.Handle, reel.Caption, customFeedAuthorHandles, customFeedExcludedAuthorHandles, customFeedHashtags))
                    .Take(take)
                    .ToArray();

            return await MapWithVariantsAsync(filteredFollowingReels, profileId, cancellationToken);
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
                && !blockedProfileIds.Contains(x.AuthorId)
                && !x.IsDraft)
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
            .Where(item => customFeed is null || CustomFeedMatcher.Matches(item.Reel.Author.Handle, item.Reel.Caption, customFeedAuthorHandles, customFeedExcludedAuthorHandles, customFeedHashtags))
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => x.Reel.CreatedAtUtc)
            .Take(take)
            .Select(x => x.Reel)
            .ToArray();

        return await MapWithVariantsAsync(ranked, profileId, cancellationToken);
    }

    public async Task<IReadOnlyCollection<ReelDto>> GetByAuthorHandleAsync(Guid profileId, string handle, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);
        await PublishDueReelsAsync(cancellationToken);

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
                && !blockedProfileIds.Contains(x.AuthorId)
                && !x.IsDraft)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        return await MapWithVariantsAsync(reels, profileId, cancellationToken);
    }

    public async Task<ReelDto?> GetPublicByIdAsync(Guid reelId, Guid? viewerId = null, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);
        await PublishDueReelsAsync(cancellationToken);

        var reel = await dbContext.Reels
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Author)
            .Include(x => x.Comments)
                .ThenInclude(comment => comment.Likes)
            .FirstOrDefaultAsync(x => x.Id == reelId && !x.IsDraft, cancellationToken);

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

        var mapped = MapToReelDto(reel, viewerId ?? Guid.Empty);
        return await ApplyVariantAsync(mapped, viewerId, cancellationToken);
    }

    public async Task<IReadOnlyCollection<ReelDto>> GetPublicByAuthorHandleAsync(string handle, Guid? viewerId = null, int take = 25, CancellationToken cancellationToken = default)
    {
        await EnsureReelSchemaAsync(cancellationToken);
        await PublishDueReelsAsync(cancellationToken);

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
            .Where(x => x.AuthorId == author.Id && !x.IsDraft)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        var mapProfileId = viewerId ?? Guid.Empty;
        return await MapWithVariantsAsync(reels, mapProfileId, cancellationToken);
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
            reel.IsSensitive,
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
                .ToArray(),
            0,
            0,
            0,
            reel.IsDraft,
            reel.ScheduledPublishAtUtc,
            reel.PublishedAtUtc);
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

    private async Task<IReadOnlyCollection<ReelDto>> MapWithVariantsAsync(IReadOnlyCollection<Reel> reels, Guid? viewerId, CancellationToken cancellationToken)
    {
        var baseDtos = reels
            .Select(reel => MapToReelDto(reel, viewerId ?? Guid.Empty))
            .ToArray();

        if (baseDtos.Length == 0)
        {
            return baseDtos;
        }

        var testByReelId = await dbContext.ReelAbTests
            .AsNoTracking()
            .Where(x => x.IsActive && baseDtos.Select(dto => dto.Id).Contains(x.ReelId))
            .ToDictionaryAsync(x => x.ReelId, x => x, cancellationToken);

        return baseDtos
            .Select(dto => ApplyVariant(dto, viewerId, testByReelId.TryGetValue(dto.Id, out var test) ? test : null))
            .ToArray();
    }

    private async Task<ReelDto> ApplyVariantAsync(ReelDto dto, Guid? viewerId, CancellationToken cancellationToken)
    {
        var test = await dbContext.ReelAbTests
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.ReelId == dto.Id && x.IsActive, cancellationToken);

        return ApplyVariant(dto, viewerId, test);
    }

    private static ReelDto ApplyVariant(ReelDto dto, Guid? viewerId, ReelAbTest? test)
    {
        if (test is null || !viewerId.HasValue)
        {
            return dto;
        }

        var variant = ResolveVariantKey(dto.Id, viewerId.Value);
        if (variant == VariantA)
        {
            return dto with
            {
                Caption = test.VariantATitle,
                ThumbnailUrl = string.IsNullOrWhiteSpace(test.VariantAThumbnailUrl) ? dto.ThumbnailUrl : test.VariantAThumbnailUrl
            };
        }

        return dto with
        {
            Caption = test.VariantBTitle,
            ThumbnailUrl = string.IsNullOrWhiteSpace(test.VariantBThumbnailUrl) ? dto.ThumbnailUrl : test.VariantBThumbnailUrl
        };
    }

    private static string ResolveVariantKey(Guid reelId, Guid viewerId)
    {
        Span<byte> buffer = stackalloc byte[16];
        reelId.TryWriteBytes(buffer);
        var hash = viewerId.GetHashCode() ^ BitConverter.ToInt32(buffer[..4]);
        return (Math.Abs(hash) % 2 == 0) ? VariantA : VariantB;
    }

    private static string? ResolveWinningVariant(ReelAbTest test)
    {
        var rateA = test.VariantAImpressions > 0 ? (double)test.VariantAViews / test.VariantAImpressions : 0;
        var rateB = test.VariantBImpressions > 0 ? (double)test.VariantBViews / test.VariantBImpressions : 0;
        if (rateA == rateB)
        {
            return null;
        }

        return rateA > rateB ? VariantA : VariantB;
    }

    private static ReelAbTestDto MapAbTest(ReelAbTest test)
    {
        var variantAViewRate = test.VariantAImpressions > 0
            ? (double)test.VariantAViews / test.VariantAImpressions * 100
            : 0;
        var variantBViewRate = test.VariantBImpressions > 0
            ? (double)test.VariantBViews / test.VariantBImpressions * 100
            : 0;

        var variantAAvgWatch = test.VariantAViews > 0
            ? test.VariantAWatchSeconds / test.VariantAViews
            : 0;
        var variantBAvgWatch = test.VariantBViews > 0
            ? test.VariantBWatchSeconds / test.VariantBViews
            : 0;

        return new ReelAbTestDto(
            test.ReelId,
            test.IsActive,
            test.WinningVariantKey,
            test.CreatedAtUtc,
            test.UpdatedAtUtc,
            new ReelAbVariantStatsDto(
                VariantA,
                test.VariantATitle,
                test.VariantAThumbnailUrl,
                test.VariantAImpressions,
                test.VariantAViews,
                test.VariantAWatchSeconds,
                variantAAvgWatch,
                variantAViewRate),
            new ReelAbVariantStatsDto(
                VariantB,
                test.VariantBTitle,
                test.VariantBThumbnailUrl,
                test.VariantBImpressions,
                test.VariantBViews,
                test.VariantBWatchSeconds,
                variantBAvgWatch,
                variantBViewRate));
    }

    private static string? NormalizeOptionalUrl(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private async Task PublishDueReelsAsync(CancellationToken cancellationToken)
    {
        var nowUtc = DateTime.UtcNow;
        var dueDrafts = await dbContext.Reels
            .Where(x => x.IsDraft && x.ScheduledPublishAtUtc.HasValue && x.ScheduledPublishAtUtc <= nowUtc)
            .ToArrayAsync(cancellationToken);

        if (dueDrafts.Length == 0)
        {
            return;
        }

        foreach (var draft in dueDrafts)
        {
            draft.IsDraft = false;
            draft.PublishedAtUtc = draft.ScheduledPublishAtUtc ?? nowUtc;
            draft.ScheduledPublishAtUtc = null;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private Task EnsureReelSchemaAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
