using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class StoryService(SocialSezContext dbContext) : IStoryService
{
    private const int DefaultExpiryHours = 24;

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

        var expiresInHours = request.ExpiresInHours ?? DefaultExpiryHours;
        expiresInHours = Math.Clamp(expiresInHours, 1, 48);

        var story = new Story
        {
            Id = Guid.NewGuid(),
            AuthorId = request.AuthorId,
            Caption = string.IsNullOrWhiteSpace(caption) ? null : caption,
            MediaUrl = mediaUrl,
            CreatedAtUtc = DateTime.UtcNow,
            ExpiresAtUtc = DateTime.UtcNow.AddHours(expiresInHours)
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

    public async Task<IReadOnlyCollection<StoryGroupDto>> GetFeedAsync(Guid profileId, int takeAuthors = 25, CancellationToken cancellationToken = default)
    {
        var nowUtc = DateTime.UtcNow;
        takeAuthors = Math.Clamp(takeAuthors, 1, 100);

        var followedIds = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);

        var activeStories = await dbContext.Stories
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Views)
            .Where(x => (followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate) && x.ExpiresAtUtc > nowUtc)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(takeAuthors * 10)
            .ToListAsync(cancellationToken);

        var grouped = activeStories
            .GroupBy(x => x.AuthorId)
            .OrderByDescending(group => group.Max(story => story.CreatedAtUtc))
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
}
