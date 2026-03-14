using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class StoryService(SocialSezContext dbContext) : IStoryService
{
    private const int StoryExpiryHours = 24;
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool storySchemaInitialized;

    public async Task<StoryDto> CreateAsync(CreateStoryRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

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

        var thumbnailUrl = request.ThumbnailUrl?.Trim();
        if (string.IsNullOrWhiteSpace(thumbnailUrl))
        {
            thumbnailUrl = null;
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
            ThumbnailUrl = thumbnailUrl,
            IsSensitive = request.IsSensitive,
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
            story.ThumbnailUrl,
            story.IsSensitive,
            story.CreatedAtUtc,
            story.ExpiresAtUtc,
            false,
            0);
    }

    public async Task<bool> DeleteAsync(Guid storyId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

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
        await EnsureStorySchemaAsync(cancellationToken);

        var nowUtc = DateTime.UtcNow;

        var story = await dbContext.Stories
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == storyId, cancellationToken);

        if (story is null || story.ExpiresAtUtc <= nowUtc)
        {
            return false;
        }

        var blockedProfileIds = await GetBlockedProfileIdsAsync(viewerId, cancellationToken);
        if (blockedProfileIds.Contains(story.AuthorId))
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
        await EnsureStorySchemaAsync(cancellationToken);

        var nowUtc = DateTime.UtcNow;
        takeAuthors = Math.Clamp(takeAuthors, 1, 100);
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

        var baseStoriesQuery = dbContext.Stories
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Views)
            .Where(x => x.ExpiresAtUtc > nowUtc)
            .Where(x => !blockedProfileIds.Contains(x.AuthorId));

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
                        story.ThumbnailUrl,
                        story.IsSensitive,
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

    public async Task<IReadOnlyCollection<StoryDto>> GetByAuthorAsync(Guid requesterId, Guid authorId, bool includeExpired = false, int take = 100, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

        if (requesterId != authorId)
        {
            throw new UnauthorizedAccessException("You can only read your own story archive.");
        }

        take = Math.Clamp(take, 1, 250);
        var nowUtc = DateTime.UtcNow;

        var stories = await dbContext.Stories
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Views)
            .Where(x => x.AuthorId == authorId && (includeExpired || x.ExpiresAtUtc > nowUtc))
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToListAsync(cancellationToken);

        return stories
            .Select(story => MapStory(story, story.Author, requesterId))
            .ToArray();
    }

    public async Task<IReadOnlyCollection<StoryCollectionDto>> GetCollectionsByAuthorHandleAsync(string handle, Guid? viewerId = null, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

        var normalizedHandle = handle.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedHandle))
        {
            return Array.Empty<StoryCollectionDto>();
        }

        var author = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Handle == normalizedHandle, cancellationToken);

        if (author is null)
        {
            return Array.Empty<StoryCollectionDto>();
        }

        if (!await CanViewerAccessAuthorStoriesAsync(author, viewerId, cancellationToken))
        {
            return Array.Empty<StoryCollectionDto>();
        }

        var collections = await dbContext.StoryCollections
            .AsNoTracking()
            .Where(x => x.ProfileId == author.Id)
            .OrderBy(x => x.CreatedAtUtc)
            .Include(x => x.Items)
                .ThenInclude(item => item.Story)
                    .ThenInclude(story => story.Author)
            .Include(x => x.Items)
                .ThenInclude(item => item.Story)
                    .ThenInclude(story => story.Views)
            .ToListAsync(cancellationToken);

        var viewer = viewerId ?? Guid.Empty;
        return collections
            .Select(collection =>
            {
                var stories = collection.Items
                    .OrderBy(item => item.AddedAtUtc)
                    .Select(item => MapStory(item.Story, item.Story.Author, viewer))
                    .ToArray();

                var cover = collection.Items
                    .OrderBy(item => item.AddedAtUtc)
                    .Select(item => item.Story.ThumbnailUrl ?? item.Story.MediaUrl)
                    .FirstOrDefault();

                return new StoryCollectionDto(
                    collection.Id,
                    author.Id,
                    author.Handle,
                    collection.Name,
                    collection.CreatedAtUtc,
                    stories.Length,
                    cover,
                    stories);
            })
            .ToArray();
    }

    public async Task<StoryCollectionDto> CreateCollectionAsync(Guid profileId, string name, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

        var trimmedName = name.Trim();
        if (string.IsNullOrWhiteSpace(trimmedName))
        {
            throw new ArgumentException("Collection name is required.", nameof(name));
        }

        if (trimmedName.Length > 80)
        {
            throw new ArgumentException("Collection name cannot exceed 80 characters.", nameof(name));
        }

        var author = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken)
            ?? throw new InvalidOperationException("Profile not found.");

        var collection = new StoryCollection
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = trimmedName,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.StoryCollections.Add(collection);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new StoryCollectionDto(
            collection.Id,
            profileId,
            author.Handle,
            collection.Name,
            collection.CreatedAtUtc,
            0,
            null,
            Array.Empty<StoryDto>());
    }

    public async Task DeleteCollectionAsync(Guid profileId, Guid collectionId, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

        var collection = await dbContext.StoryCollections
            .FirstOrDefaultAsync(x => x.Id == collectionId && x.ProfileId == profileId, cancellationToken)
            ?? throw new InvalidOperationException("Collection not found.");

        dbContext.StoryCollections.Remove(collection);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<StoryCollectionDto> AddStoryToCollectionAsync(Guid profileId, Guid collectionId, Guid storyId, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

        var collection = await dbContext.StoryCollections
            .Include(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == collectionId && x.ProfileId == profileId, cancellationToken)
            ?? throw new InvalidOperationException("Collection not found.");

        var story = await dbContext.Stories
            .Include(x => x.Author)
            .Include(x => x.Views)
            .FirstOrDefaultAsync(x => x.Id == storyId && x.AuthorId == profileId, cancellationToken)
            ?? throw new InvalidOperationException("Story not found.");

        var exists = await dbContext.StoryCollectionItems
            .AnyAsync(x => x.CollectionId == collectionId && x.StoryId == storyId, cancellationToken);

        if (!exists)
        {
            dbContext.StoryCollectionItems.Add(new StoryCollectionItem
            {
                CollectionId = collectionId,
                StoryId = storyId,
                AddedAtUtc = DateTime.UtcNow
            });

            await dbContext.SaveChangesAsync(cancellationToken);
        }

        var refreshed = await dbContext.StoryCollections
            .AsNoTracking()
            .Where(x => x.Id == collectionId)
            .Include(x => x.Items)
                .ThenInclude(item => item.Story)
                    .ThenInclude(itemStory => itemStory.Author)
            .Include(x => x.Items)
                .ThenInclude(item => item.Story)
                    .ThenInclude(itemStory => itemStory.Views)
            .FirstAsync(cancellationToken);

        var stories = refreshed.Items
            .OrderBy(item => item.AddedAtUtc)
            .Select(item => MapStory(item.Story, item.Story.Author, profileId))
            .ToArray();

        var cover = refreshed.Items
            .OrderBy(item => item.AddedAtUtc)
            .Select(item => item.Story.ThumbnailUrl ?? item.Story.MediaUrl)
            .FirstOrDefault();

        return new StoryCollectionDto(
            refreshed.Id,
            profileId,
            collection.Profile.Handle,
            refreshed.Name,
            refreshed.CreatedAtUtc,
            stories.Length,
            cover,
            stories);
    }

    public async Task<StoryCollectionDto> RemoveStoryFromCollectionAsync(Guid profileId, Guid collectionId, Guid storyId, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

        var collection = await dbContext.StoryCollections
            .Include(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == collectionId && x.ProfileId == profileId, cancellationToken)
            ?? throw new InvalidOperationException("Collection not found.");

        var item = await dbContext.StoryCollectionItems
            .FirstOrDefaultAsync(x => x.CollectionId == collectionId && x.StoryId == storyId, cancellationToken)
            ?? throw new InvalidOperationException("Story is not in this collection.");

        dbContext.StoryCollectionItems.Remove(item);
        await dbContext.SaveChangesAsync(cancellationToken);

        var refreshed = await dbContext.StoryCollections
            .AsNoTracking()
            .Where(x => x.Id == collectionId)
            .Include(x => x.Items)
                .ThenInclude(collectionItem => collectionItem.Story)
                    .ThenInclude(itemStory => itemStory.Author)
            .Include(x => x.Items)
                .ThenInclude(collectionItem => collectionItem.Story)
                    .ThenInclude(itemStory => itemStory.Views)
            .FirstAsync(cancellationToken);

        var stories = refreshed.Items
            .OrderBy(collectionItem => collectionItem.AddedAtUtc)
            .Select(collectionItem => MapStory(collectionItem.Story, collectionItem.Story.Author, profileId))
            .ToArray();

        var cover = refreshed.Items
            .OrderBy(collectionItem => collectionItem.AddedAtUtc)
            .Select(collectionItem => collectionItem.Story.ThumbnailUrl ?? collectionItem.Story.MediaUrl)
            .FirstOrDefault();

        return new StoryCollectionDto(
            refreshed.Id,
            profileId,
            collection.Profile.Handle,
            refreshed.Name,
            refreshed.CreatedAtUtc,
            stories.Length,
            cover,
            stories);
    }

    public async Task<StoryDto?> GetPublicByIdAsync(Guid storyId, CancellationToken cancellationToken = default)
    {
        return await GetPublicByIdAsync(storyId, null, cancellationToken);
    }

    public async Task<StoryDto?> GetPublicByIdAsync(Guid storyId, Guid? viewerId, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

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

        if (viewerId.HasValue)
        {
            var blockedProfileIds = await GetBlockedProfileIdsAsync(viewerId.Value, cancellationToken);
            if (blockedProfileIds.Contains(story.AuthorId))
            {
                return null;
            }
        }

        return new StoryDto(
            story.Id,
            story.AuthorId,
            story.Author.Handle,
            story.Author.ImageUrl,
            story.Caption,
            story.MediaUrl,
            story.ThumbnailUrl,
            story.IsSensitive,
            story.CreatedAtUtc,
            story.ExpiresAtUtc,
            false,
            story.Views.Count);
    }

    public async Task<StoryGroupDto?> GetPublicByAuthorHandleAsync(string handle, Guid? viewerId = null, CancellationToken cancellationToken = default)
    {
        await EnsureStorySchemaAsync(cancellationToken);

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

        if (viewerId.HasValue)
        {
            var blockedProfileIds = await GetBlockedProfileIdsAsync(viewerId.Value, cancellationToken);
            if (blockedProfileIds.Contains(author.Id))
            {
                return null;
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
            return new StoryGroupDto(
                author.Id,
                author.Handle,
                author.ImageUrl,
                false,
                Array.Empty<StoryDto>());
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
                story.ThumbnailUrl,
                story.IsSensitive,
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

    private async Task<bool> CanViewerAccessAuthorStoriesAsync(UserProfile author, Guid? viewerId, CancellationToken cancellationToken)
    {
        if (!viewerId.HasValue)
        {
            return !author.IsPrivate;
        }

        var blockedProfileIds = await GetBlockedProfileIdsAsync(viewerId.Value, cancellationToken);
        if (blockedProfileIds.Contains(author.Id))
        {
            return false;
        }

        if (!author.IsPrivate || viewerId.Value == author.Id)
        {
            return true;
        }

        return await dbContext.Follows
            .AsNoTracking()
            .AnyAsync(x => x.FollowerId == viewerId.Value && x.FollowedId == author.Id, cancellationToken);
    }

    private static StoryDto MapStory(Story story, UserProfile author, Guid viewerId)
    {
        return new StoryDto(
            story.Id,
            story.AuthorId,
            author.Handle,
            author.ImageUrl,
            story.Caption,
            story.MediaUrl,
            story.ThumbnailUrl,
            story.IsSensitive,
            story.CreatedAtUtc,
            story.ExpiresAtUtc,
            viewerId != Guid.Empty && story.Views.Any(view => view.ViewerId == viewerId),
            story.Views.Count);
    }

    private async Task EnsureStorySchemaAsync(CancellationToken cancellationToken)
    {
        if (storySchemaInitialized || !dbContext.Database.IsSqlite())
        {
            return;
        }

        await SchemaInitLock.WaitAsync(cancellationToken);
        try
        {
            if (storySchemaInitialized)
            {
                return;
            }

            try
            {
                await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE Stories ADD COLUMN IsSensitive INTEGER NOT NULL DEFAULT 0;", cancellationToken);
            }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
            {
            }

            try
            {
                await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE Stories ADD COLUMN ThumbnailUrl TEXT NULL;", cancellationToken);
            }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
            {
            }

            await dbContext.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS StoryCollections (
    Id TEXT NOT NULL PRIMARY KEY,
    ProfileId TEXT NOT NULL,
    Name TEXT NOT NULL,
    CreatedAtUtc TEXT NOT NULL,
    CONSTRAINT FK_StoryCollections_UserProfiles_ProfileId FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS StoryCollectionItems (
    CollectionId TEXT NOT NULL,
    StoryId TEXT NOT NULL,
    AddedAtUtc TEXT NOT NULL,
    CONSTRAINT PK_StoryCollectionItems PRIMARY KEY (CollectionId, StoryId),
    CONSTRAINT FK_StoryCollectionItems_StoryCollections_CollectionId FOREIGN KEY (CollectionId) REFERENCES StoryCollections (Id) ON DELETE CASCADE,
    CONSTRAINT FK_StoryCollectionItems_Stories_StoryId FOREIGN KEY (StoryId) REFERENCES Stories (Id) ON DELETE CASCADE
);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_StoryCollections_ProfileId_CreatedAtUtc ON StoryCollections (ProfileId, CreatedAtUtc);", cancellationToken);
            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_StoryCollectionItems_CollectionId_AddedAtUtc ON StoryCollectionItems (CollectionId, AddedAtUtc);", cancellationToken);
            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_StoryCollectionItems_StoryId ON StoryCollectionItems (StoryId);", cancellationToken);

            storySchemaInitialized = true;
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }
}
