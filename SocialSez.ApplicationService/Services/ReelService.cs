using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class ReelService(SocialSezContext dbContext) : IReelService
{
    public async Task<ReelDto> CreateAsync(CreateReelRequest request, CancellationToken cancellationToken = default)
    {
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
            false);
    }

    public async Task<bool> DeleteAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default)
    {
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

    public async Task<ReelDto?> ToggleLikeAsync(Guid reelId, Guid profileId, CancellationToken cancellationToken = default)
    {
        var reel = await dbContext.Reels
            .Include(x => x.Author)
            .Include(x => x.Likes)
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

    public async Task<IReadOnlyCollection<ReelDto>> GetFeedAsync(Guid profileId, int take = 25, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 100);

        var followedIds = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == profileId)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        followedIds.Add(profileId);

        var reels = await dbContext.Reels
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Likes)
            .Where(x => followedIds.Contains(x.AuthorId) || !x.Author.IsPrivate)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToArrayAsync(cancellationToken);

        return reels
            .Select(x => MapToReelDto(x, profileId))
            .ToArray();
    }

    private static ReelDto MapToReelDto(Reel reel, Guid profileId)
    {
        return new ReelDto(
            reel.Id,
            reel.AuthorId,
            reel.Author.Handle,
            reel.Author.ImageUrl,
            reel.Caption,
            reel.VideoUrl,
            reel.ThumbnailUrl,
            reel.DurationSeconds,
            reel.CreatedAtUtc,
            reel.Likes.Count,
            reel.Likes.Any(x => x.ProfileId == profileId));
    }
}
