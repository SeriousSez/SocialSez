using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class CustomFeedService(SocialSezContext dbContext) : ICustomFeedService
{
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool customFeedSchemaInitialized;

    public async Task<IReadOnlyCollection<CustomFeedDto>> GetMineAsync(Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureCustomFeedSchemaAsync(cancellationToken);

        var feeds = await dbContext.CustomFeeds
            .AsNoTracking()
            .Where(x => x.ProfileId == profileId)
            .OrderByDescending(x => x.UpdatedAtUtc)
            .ThenBy(x => x.CreatedAtUtc)
            .ToArrayAsync(cancellationToken);

        return feeds.Select(MapToDto).ToArray();
    }

    public async Task<CustomFeedDto?> GetByIdAsync(Guid profileId, Guid customFeedId, CancellationToken cancellationToken = default)
    {
        await EnsureCustomFeedSchemaAsync(cancellationToken);

        var feed = await dbContext.CustomFeeds
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.ProfileId == profileId && x.Id == customFeedId, cancellationToken);

        return feed is null ? null : MapToDto(feed);
    }

    public async Task<CustomFeedDto> CreateAsync(Guid profileId, CreateCustomFeedRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCustomFeedSchemaAsync(cancellationToken);

        var normalized = NormalizeRequest(request.Name, request.AuthorHandles, request.Hashtags);
        var nowUtc = DateTime.UtcNow;
        var entity = new CustomFeed
        {
            Id = Guid.NewGuid(),
            ProfileId = profileId,
            Name = normalized.Name,
            AuthorHandlesJson = Serialize(normalized.AuthorHandles),
            HashtagsJson = Serialize(normalized.Hashtags),
            CreatedAtUtc = nowUtc,
            UpdatedAtUtc = nowUtc
        };

        dbContext.CustomFeeds.Add(entity);
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToDto(entity);
    }

    public async Task<CustomFeedDto?> UpdateAsync(Guid profileId, Guid customFeedId, UpdateCustomFeedRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCustomFeedSchemaAsync(cancellationToken);

        var entity = await dbContext.CustomFeeds
            .FirstOrDefaultAsync(x => x.ProfileId == profileId && x.Id == customFeedId, cancellationToken);

        if (entity is null)
        {
            return null;
        }

        var normalized = NormalizeRequest(request.Name, request.AuthorHandles, request.Hashtags);
        entity.Name = normalized.Name;
        entity.AuthorHandlesJson = Serialize(normalized.AuthorHandles);
        entity.HashtagsJson = Serialize(normalized.Hashtags);
        entity.UpdatedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapToDto(entity);
    }

    public async Task<bool> DeleteAsync(Guid profileId, Guid customFeedId, CancellationToken cancellationToken = default)
    {
        await EnsureCustomFeedSchemaAsync(cancellationToken);

        var entity = await dbContext.CustomFeeds
            .FirstOrDefaultAsync(x => x.ProfileId == profileId && x.Id == customFeedId, cancellationToken);

        if (entity is null)
        {
            return false;
        }

        dbContext.CustomFeeds.Remove(entity);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static (string Name, string[] AuthorHandles, string[] Hashtags) NormalizeRequest(string? name, IReadOnlyCollection<string>? authorHandles, IReadOnlyCollection<string>? hashtags)
    {
        var normalizedName = (name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            throw new ArgumentException("Custom feed name is required.", nameof(name));
        }

        if (normalizedName.Length > 80)
        {
            throw new ArgumentException("Custom feed name cannot exceed 80 characters.", nameof(name));
        }

        var normalizedHandles = CustomFeedMatcher.NormalizeHandles(authorHandles);
        var normalizedHashtags = CustomFeedMatcher.NormalizeHashtags(hashtags);
        if (normalizedHandles.Length == 0 && normalizedHashtags.Length == 0)
        {
            throw new ArgumentException("Add at least one author handle or hashtag.", nameof(authorHandles));
        }

        return (normalizedName, normalizedHandles, normalizedHashtags);
    }

    private static string? Serialize(IReadOnlyCollection<string> values)
        => values.Count == 0 ? null : JsonSerializer.Serialize(values);

    private static string[] ParseJsonArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(raw)
                ?.Where(value => !string.IsNullOrWhiteSpace(value))
                .ToArray()
                ?? [];
        }
        catch
        {
            return [];
        }
    }

    private static CustomFeedDto MapToDto(CustomFeed entity)
        => new(
            entity.Id,
            entity.Name,
            ParseJsonArray(entity.AuthorHandlesJson),
            ParseJsonArray(entity.HashtagsJson),
            entity.CreatedAtUtc,
            entity.UpdatedAtUtc);

    private async Task EnsureCustomFeedSchemaAsync(CancellationToken cancellationToken)
    {
        if (customFeedSchemaInitialized)
        {
            return;
        }

        await SchemaInitLock.WaitAsync(cancellationToken);
        try
        {
            if (customFeedSchemaInitialized)
            {
                return;
            }

            await dbContext.Database.ExecuteSqlRawAsync(
                """
                    CREATE TABLE IF NOT EXISTS `CustomFeeds` (
                        `Id` char(36) NOT NULL,
                        `ProfileId` char(36) NOT NULL,
                        `Name` varchar(80) NOT NULL,
                        `AuthorHandlesJson` longtext NULL,
                        `HashtagsJson` longtext NULL,
                        `CreatedAtUtc` datetime(6) NOT NULL,
                        `UpdatedAtUtc` datetime(6) NOT NULL,
                        PRIMARY KEY (`Id`),
                        KEY `IX_CustomFeeds_ProfileId_UpdatedAtUtc` (`ProfileId`, `UpdatedAtUtc`),
                        CONSTRAINT `FK_CustomFeeds_UserProfiles_ProfileId` FOREIGN KEY (`ProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE CASCADE
                    );
                    """,
                cancellationToken);

            customFeedSchemaInitialized = true;
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }
}