using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;
using System.Text.Json;

namespace SocialSez.ApplicationService.Services;

public class SavedCollectionService(SocialSezContext dbContext) : ISavedCollectionService
{
    private const string LikeReactionType = "Like";

    public async Task<IReadOnlyList<SavedItemDto>> GetAllSavedItemsAsync(Guid profileId, int take, int skip)
    {
        var items = await dbContext.SavedItems
            .Where(x => x.ProfileId == profileId)
            .OrderByDescending(x => x.SavedAtUtc)
            .Skip(skip)
            .Take(take)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Author)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Reactions)
                    .ThenInclude(r => r.Profile)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Comments)
                    .ThenInclude(c => c.Author)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Comments)
                    .ThenInclude(c => c.Reactions)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Author)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Likes)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Comments)
                    .ThenInclude(c => c.Author)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Comments)
                    .ThenInclude(c => c.Likes)
            .ToListAsync();

        return items.Select(i => MapToDto(i, profileId)).ToList();
    }

    public async Task<IReadOnlyList<SavedCollectionDto>> GetCollectionsAsync(Guid profileId)
    {
        var collections = await dbContext.SavedCollections
            .Where(x => x.ProfileId == profileId)
            .OrderBy(x => x.CreatedAtUtc)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.CreatedAtUtc,
                ItemCount = c.Items.Count,
                CoverThumbnail = c.Items
                    .OrderByDescending(i => i.AddedAtUtc)
                    .Select(i => i.SavedItem.Post != null
                        ? i.SavedItem.Post.ImageUrl
                        : i.SavedItem.Reel != null ? i.SavedItem.Reel.ThumbnailUrl : null)
                    .FirstOrDefault()
            })
            .ToListAsync();

        return collections
            .Select(c => new SavedCollectionDto(c.Id, c.Name, c.CreatedAtUtc, c.ItemCount, c.CoverThumbnail))
            .ToList();
    }

    public async Task<SavedCollectionDto> CreateCollectionAsync(Guid profileId, string name)
    {
        var collection = new SavedCollection
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = name.Trim(),
            CreatedAtUtc = DateTime.UtcNow
        };
        dbContext.SavedCollections.Add(collection);
        await dbContext.SaveChangesAsync();
        return new SavedCollectionDto(collection.Id, collection.Name, collection.CreatedAtUtc, 0, null);
    }

    public async Task DeleteCollectionAsync(Guid profileId, Guid collectionId)
    {
        var collection = await dbContext.SavedCollections
            .FirstOrDefaultAsync(x => x.Id == collectionId && x.ProfileId == profileId);
        if (collection is null) return;
        dbContext.SavedCollections.Remove(collection);
        await dbContext.SaveChangesAsync();
    }

    public async Task<SavedCollectionDto> RenameCollectionAsync(Guid profileId, Guid collectionId, string name)
    {
        var collection = await dbContext.SavedCollections
            .FirstOrDefaultAsync(x => x.Id == collectionId && x.ProfileId == profileId)
            ?? throw new InvalidOperationException("Collection not found.");
        collection.Name = name.Trim();
        await dbContext.SaveChangesAsync();
        var itemCount = await dbContext.SavedCollectionItems.CountAsync(x => x.CollectionId == collectionId);
        return new SavedCollectionDto(collection.Id, collection.Name, collection.CreatedAtUtc, itemCount, null);
    }

    public async Task<IReadOnlyList<SavedItemDto>> GetCollectionItemsAsync(Guid profileId, Guid collectionId, int take, int skip)
    {
        var collectionExists = await dbContext.SavedCollections
            .AnyAsync(x => x.Id == collectionId && x.ProfileId == profileId);
        if (!collectionExists) return [];

        var items = await dbContext.SavedCollectionItems
            .Where(x => x.CollectionId == collectionId && x.SavedItem.ProfileId == profileId)
            .OrderByDescending(x => x.AddedAtUtc)
            .Skip(skip)
            .Take(take)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Post)
                    .ThenInclude(p => p!.Author)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Post)
                    .ThenInclude(p => p!.Reactions)
                        .ThenInclude(r => r.Profile)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Post)
                    .ThenInclude(p => p!.Comments)
                        .ThenInclude(c => c.Author)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Post)
                    .ThenInclude(p => p!.Comments)
                        .ThenInclude(c => c.Reactions)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Reel)
                    .ThenInclude(r => r!.Author)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Reel)
                    .ThenInclude(r => r!.Likes)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Reel)
                    .ThenInclude(r => r!.Comments)
                        .ThenInclude(c => c.Author)
            .Include(x => x.SavedItem)
                .ThenInclude(s => s.Reel)
                    .ThenInclude(r => r!.Comments)
                        .ThenInclude(c => c.Likes)
            .ToListAsync();

        return items.Select(x => MapToDto(x.SavedItem, profileId)).ToList();
    }

    public async Task<SavedItemDto> SavePostAsync(Guid profileId, Guid postId)
    {
        var existing = await dbContext.SavedItems
            .FirstOrDefaultAsync(x => x.ProfileId == profileId && x.PostId == postId);
        if (existing is not null)
        {
            return await LoadAndMapSavedItemAsync(existing.Id, profileId);
        }

        var post = await dbContext.Posts.FirstOrDefaultAsync(x => x.Id == postId)
            ?? throw new InvalidOperationException("Post not found.");

        var item = new SavedItem
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            ItemType = "Post",
            PostId = postId,
            SavedAtUtc = DateTime.UtcNow
        };
        dbContext.SavedItems.Add(item);
        await dbContext.SaveChangesAsync();
        return await LoadAndMapSavedItemAsync(item.Id, profileId);
    }

    public async Task<SavedItemDto> SaveReelAsync(Guid profileId, Guid reelId)
    {
        var existing = await dbContext.SavedItems
            .FirstOrDefaultAsync(x => x.ProfileId == profileId && x.ReelId == reelId);
        if (existing is not null)
        {
            return await LoadAndMapSavedItemAsync(existing.Id, profileId);
        }

        var reel = await dbContext.Reels.FirstOrDefaultAsync(x => x.Id == reelId)
            ?? throw new InvalidOperationException("Reel not found.");

        var item = new SavedItem
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            ItemType = "Reel",
            ReelId = reelId,
            SavedAtUtc = DateTime.UtcNow
        };
        dbContext.SavedItems.Add(item);
        await dbContext.SaveChangesAsync();
        return await LoadAndMapSavedItemAsync(item.Id, profileId);
    }

    public async Task UnsaveItemAsync(Guid profileId, Guid savedItemId)
    {
        var item = await dbContext.SavedItems
            .FirstOrDefaultAsync(x => x.Id == savedItemId && x.ProfileId == profileId);
        if (item is null) return;
        dbContext.SavedItems.Remove(item);
        await dbContext.SaveChangesAsync();
    }

    public async Task AddToCollectionAsync(Guid profileId, Guid savedItemId, Guid collectionId)
    {
        var collectionExists = await dbContext.SavedCollections
            .AnyAsync(x => x.Id == collectionId && x.ProfileId == profileId);
        if (!collectionExists) throw new InvalidOperationException("Collection not found.");

        var itemExists = await dbContext.SavedItems
            .AnyAsync(x => x.Id == savedItemId && x.ProfileId == profileId);
        if (!itemExists) throw new InvalidOperationException("Saved item not found.");

        var alreadyAdded = await dbContext.SavedCollectionItems
            .AnyAsync(x => x.CollectionId == collectionId && x.SavedItemId == savedItemId);
        if (alreadyAdded) return;

        dbContext.SavedCollectionItems.Add(new SavedCollectionItem
        {
            CollectionId = collectionId,
            SavedItemId = savedItemId,
            AddedAtUtc = DateTime.UtcNow
        });
        await dbContext.SaveChangesAsync();
    }

    public async Task RemoveFromCollectionAsync(Guid profileId, Guid savedItemId, Guid collectionId)
    {
        var link = await dbContext.SavedCollectionItems
            .FirstOrDefaultAsync(x =>
                x.CollectionId == collectionId &&
                x.SavedItemId == savedItemId &&
                x.SavedItem.ProfileId == profileId);
        if (link is null) return;
        dbContext.SavedCollectionItems.Remove(link);
        await dbContext.SaveChangesAsync();
    }

    public async Task<SavedStatusDto> GetSavedStatusAsync(Guid profileId, IEnumerable<Guid> postIds, IEnumerable<Guid> reelIds)
    {
        var postIdList = postIds.ToList();
        var reelIdList = reelIds.ToList();

        var savedItems = await dbContext.SavedItems
            .Where(x => x.ProfileId == profileId &&
                ((x.PostId != null && postIdList.Contains(x.PostId.Value)) ||
                 (x.ReelId != null && reelIdList.Contains(x.ReelId.Value))))
            .Select(x => new { x.Id, x.PostId, x.ReelId })
            .ToListAsync();

        var savedPostIds = savedItems
            .Where(x => x.PostId.HasValue)
            .ToDictionary(x => x.PostId!.Value, x => x.Id);

        var savedReelIds = savedItems
            .Where(x => x.ReelId.HasValue)
            .ToDictionary(x => x.ReelId!.Value, x => x.Id);

        return new SavedStatusDto(savedPostIds, savedReelIds);
    }

    private async Task<SavedItemDto> LoadAndMapSavedItemAsync(Guid savedItemId, Guid profileId)
    {
        var item = await dbContext.SavedItems
            .Where(x => x.Id == savedItemId)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Author)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Reactions)
                    .ThenInclude(r => r.Profile)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Comments)
                    .ThenInclude(c => c.Author)
            .Include(x => x.Post)
                .ThenInclude(p => p!.Comments)
                    .ThenInclude(c => c.Reactions)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Author)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Likes)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Comments)
                    .ThenInclude(c => c.Author)
            .Include(x => x.Reel)
                .ThenInclude(r => r!.Comments)
                    .ThenInclude(c => c.Likes)
            .FirstOrDefaultAsync()
            ?? throw new InvalidOperationException("Saved item not found after insert.");

        return MapToDto(item, profileId);
    }

    private static SavedItemDto MapToDto(SavedItem item, Guid profileId)
    {
        PostDto? postDto = null;
        ReelDto? reelDto = null;

        if (item.Post is not null)
        {
            postDto = MapPost(item.Post, profileId);
        }
        else if (item.Reel is not null)
        {
            reelDto = MapReel(item.Reel, profileId);
        }

        return new SavedItemDto(item.Id, item.ItemType, item.PostId, item.ReelId, item.SavedAtUtc, postDto, reelDto);
    }

    private static PostDto MapPost(Post post, Guid profileId)
    {
        var imageUrls = ParsePostMediaUrls(post.ImageUrl);
        var primaryImageUrl = imageUrls.FirstOrDefault();

        var comments = post.Comments
            .OrderBy(x => x.CreatedAtUtc)
            .Select(x => new CommentDto(
                x.Id, x.PostId, x.AuthorId, x.ParentCommentId,
                x.Author.Handle, x.Author.ImageUrl, x.Content, x.CreatedAtUtc,
                x.Reactions.FirstOrDefault(r => r.ProfileId == profileId)?.Type,
                x.Reactions
                    .GroupBy(r => r.Type)
                    .Select(g => new ReactionSummaryDto(g.Key, g.Count()))
                    .OrderByDescending(r => r.Count).ThenBy(r => r.Type)
                    .ToArray()))
            .ToArray();

        var reactions = post.Reactions
            .GroupBy(x => x.Type)
            .Select(g => new ReactionSummaryDto(g.Key, g.Count()))
            .OrderByDescending(x => x.Count).ThenBy(x => x.Type)
            .ToArray();

        var reactionDetails = post.Reactions
            .Where(x => x.Profile is not null)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => new PostReactionDetailDto(
                x.ProfileId, x.Profile.Handle, x.Profile.DisplayName, x.Profile.Bio,
                x.Profile.ImageUrl, x.Type, x.CreatedAtUtc))
            .ToArray();

        var myReactionType = post.Reactions.FirstOrDefault(x => x.ProfileId == profileId)?.Type;
        var likeCount = post.Reactions.Count(x => string.Equals(x.Type, LikeReactionType, StringComparison.OrdinalIgnoreCase));

        return new PostDto(
            post.Id, post.AuthorId, post.Author.Handle, post.Author.ImageUrl,
            post.Content, primaryImageUrl, imageUrls, post.IsSensitive, post.CreatedAtUtc,
            likeCount,
            string.Equals(myReactionType, LikeReactionType, StringComparison.OrdinalIgnoreCase),
            myReactionType, reactions, reactionDetails, comments);
    }

    private static ReelDto MapReel(Reel reel, Guid profileId)
    {
        return new ReelDto(
            reel.Id, reel.AuthorId,
            reel.Author?.Handle ?? "unknown",
            reel.Author?.ImageUrl,
            reel.Caption, reel.VideoUrl, reel.ThumbnailUrl,
            reel.IsSensitive, reel.DurationSeconds, reel.CreatedAtUtc,
            reel.Likes.Count,
            reel.Likes.Any(x => x.ProfileId == profileId),
            reel.Comments
                .OrderBy(c => c.CreatedAtUtc)
                .Select(c => new ReelCommentDto(
                    c.Id, c.ReelId, c.AuthorId, c.ParentCommentId,
                    c.Author?.Handle ?? "deleted-user", c.Author?.ImageUrl,
                    c.Content, c.CreatedAtUtc,
                    c.Likes.Count, c.Likes.Any(l => l.ProfileId == profileId)))
                .ToArray());
    }

    private static string[] ParsePostMediaUrls(string? rawImageUrl)
    {
        var raw = rawImageUrl?.Trim();
        if (string.IsNullOrWhiteSpace(raw))
            return Array.Empty<string>();

        if (raw.StartsWith("[", StringComparison.Ordinal))
        {
            try
            {
                return JsonSerializer.Deserialize<string[]>(raw) ?? Array.Empty<string>();
            }
            catch
            {
                return [raw];
            }
        }
        return [raw];
    }
}
