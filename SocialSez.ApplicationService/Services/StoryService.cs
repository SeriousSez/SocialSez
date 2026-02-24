using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class StoryService(SocialSezContext dbContext) : IStoryService
{
    private const int StoryExpiryHours = 24;

    public async Task<StoryDto> CreateAsync(CreateStoryRequest request, CancellationToken cancellationToken = default)
    {
        var author = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.AuthorId, cancellationToken);

        if (author is null)
        {
            throw new InvalidOperationException("Author does not exist.");
        }

        var mediaUrl = request.MediaUrl?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(mediaUrl))
        {
            throw new ArgumentException("Story media is required.", nameof(request));
        }

        var caption = request.Caption?.Trim();
        if (caption?.Length > 300)
        {
            throw new ArgumentException("Story caption cannot exceed 300 characters.", nameof(request));
        }

        var story = new Story
        {
            Id = Guid.NewGuid(),
            AuthorId = request.AuthorId,
            Caption = string.IsNullOrWhiteSpace(caption) ? null : caption,
            MediaUrl = mediaUrl,
            CreatedAtUtc = DateTime.UtcNow,
            ExpiresAtUtc = DateTime.UtcNow.AddHours(StoryExpiryHours)
        };

        dbContext.Stories.Add(story);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new StoryDto(
            story.Id,
            story.AuthorId,
            author.Handle,
            author.ImageUrl,
            story.Caption,
            story.MediaUrl,
            story.CreatedAtUtc,
            story.ExpiresAtUtc,
            false,
            0);
    }

    public async Task<bool> DeleteAsync(Guid storyId, Guid profileId, CancellationToken cancellationToken = default)
    {
        var story = await dbContext.Stories.FirstOrDefaultAsync(x => x.Id == storyId, cancellationToken);
        if (story is null)
        {
            return false;
        }

        if (story.AuthorId != profileId)
        {
            throw new UnauthorizedAccessException("You can only delete your own stories.");
        }

        dbContext.Stories.Remove(story);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> MarkViewedAsync(Guid storyId, Guid viewerId, CancellationToken cancellationToken = default)
    {
        var nowUtc = DateTime.UtcNow;

        var story = await dbContext.Stories
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == storyId, cancellationToken);

        if (story is null || story.ExpiresAtUtc <= nowUtc)
        {
            return false;
        }

        var alreadyViewed = await dbContext.StoryViews.AnyAsync(
            x => x.StoryId == storyId && x.ViewerId == viewerId,
            cancellationToken);

        if (alreadyViewed)
        {
            return true;
        }

        dbContext.StoryViews.Add(new StoryView
        {
            StoryId = storyId,
            ViewerId = viewerId,
            ViewedAtUtc = nowUtc
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<IReadOnlyCollection<StoryGroupDto>> GetFeedAsync(Guid profileId, int takeAuthors = 25, FeedMode mode = FeedMode.ForYou, CancellationToken cancellationToken = default)
    {
        var nowUtc = DateTime.UtcNow;
        takeAuthors = Math.Clamp(takeAuthors, 1, 100);

        var followedIds = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);

        var followedSet = followedIds.ToHashSet();

        var baseStoriesQuery = dbContext.Stories
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Views)
            .Where(x => x.ExpiresAtUtc > nowUtc);

        var activeStories = await (mode == FeedMode.Following
            ? baseStoriesQuery
                .Where(x => followedIds.Contains(x.AuthorId))
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(takeAuthors * 10)
            : baseStoriesQuery
                .Where(x => followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate)
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(takeAuthors * 20))
            .ToListAsync(cancellationToken);

        Dictionary<Guid, double> watchAffinityByAuthor = new();
        if (mode == FeedMode.ForYou)
        {
            var recentWindowUtc = nowUtc.AddDays(-14);
            watchAffinityByAuthor = await dbContext.StoryViews
                .AsNoTracking()
                .Where(x => x.ViewerId == profileId)
                .Join(
                    dbContext.Stories.AsNoTracking(),
                    view => view.StoryId,
                    story => story.Id,
                    (view, story) => new { story.AuthorId, view.ViewedAtUtc })
                .GroupBy(x => x.AuthorId)
                .Select(group => new
                {
                    AuthorId = group.Key,
                    Score = group.Sum(item => item.ViewedAtUtc >= recentWindowUtc ? 2.0 : 1.0)
                })
                .ToDictionaryAsync(x => x.AuthorId, x => x.Score, cancellationToken);
        }

        var grouped = activeStories
            .GroupBy(x => x.AuthorId)
            .Where(group => mode == FeedMode.ForYou || followedSet.Contains(group.Key))
            .OrderByDescending(group =>
                mode == FeedMode.ForYou && watchAffinityByAuthor.TryGetValue(group.Key, out var score)
                    ? score
                    : 0d)
            .ThenByDescending(group => group.Max(story => story.CreatedAtUtc))
            .Take(takeAuthors)
            .Select(group =>
            {
                var orderedStories = group
                    .OrderBy(x => x.CreatedAtUtc)
                    .ToArray();

                var storyDtos = orderedStories
                    .Select(story => new StoryDto(
                        story.Id,
                        story.AuthorId,
                        story.Author.Handle,
                        story.Author.ImageUrl,
                        story.Caption,
                        story.MediaUrl,
                        story.CreatedAtUtc,
                        story.ExpiresAtUtc,
                        story.Views.Any(view => view.ViewerId == profileId),
                        story.Views.Count))
                    .ToArray();

                return new StoryGroupDto(
                    group.Key,
                    orderedStories[0].Author.Handle,
                    orderedStories[0].Author.ImageUrl,
                    storyDtos.Any(x => !x.ViewedByMe),
                    storyDtos);
            })
            .ToArray();

        return grouped;
    }

    public async Task<StoryDto?> GetPublicByIdAsync(Guid storyId, CancellationToken cancellationToken = default)
    {
        var nowUtc = DateTime.UtcNow;

        var story = await dbContext.Stories
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Views)
            .FirstOrDefaultAsync(x => x.Id == storyId && x.ExpiresAtUtc > nowUtc, cancellationToken);

        if (story is null)
        {
            return null;
        }

        return new StoryDto(
            story.Id,
            story.AuthorId,
            story.Author.Handle,
            story.Author.ImageUrl,
            story.Caption,
            story.MediaUrl,
            story.CreatedAtUtc,
            story.ExpiresAtUtc,
            false,
            story.Views.Count);
    }

    public async Task<StoryGroupDto?> GetPublicByAuthorHandleAsync(string handle, Guid? viewerId = null, CancellationToken cancellationToken = default)
    {
        var normalizedHandle = handle.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedHandle))
        {
            return null;
        }

        var author = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Handle == normalizedHandle, cancellationToken);

        if (author is null)
        {
            return null;
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
            return null;
        }

        var nowUtc = DateTime.UtcNow;
        var stories = await dbContext.Stories
            .AsNoTracking()
            .Include(x => x.Views)
            .Where(x => x.AuthorId == author.Id && x.ExpiresAtUtc > nowUtc)
            .OrderBy(x => x.CreatedAtUtc)
            .ToArrayAsync(cancellationToken);

        if (!stories.Any())
        {
            return null;
        }

        var viewer = viewerId ?? Guid.Empty;
        var storyDtos = stories
            .Select(story => new StoryDto(
                story.Id,
                story.AuthorId,
                author.Handle,
                author.ImageUrl,
                story.Caption,
                story.MediaUrl,
                story.CreatedAtUtc,
                story.ExpiresAtUtc,
                viewerId.HasValue && story.Views.Any(view => view.ViewerId == viewer),
                story.Views.Count))
            .ToArray();

        return new StoryGroupDto(
            author.Id,
            author.Handle,
            author.ImageUrl,
            storyDtos.Any(x => !x.ViewedByMe),
            storyDtos);
    }
}
