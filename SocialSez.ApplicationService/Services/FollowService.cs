using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class FollowService(SocialSezContext dbContext) : IFollowService
{
    public async Task<bool> FollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default)
    {
        if (followerId == followedId)
        {
            return false;
        }

        var exists = await dbContext.Follows.AnyAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId,
            cancellationToken);

        if (exists)
        {
            return true;
        }

        var profilesExist = await dbContext.UserProfiles.AnyAsync(x => x.Id == followerId, cancellationToken)
            && await dbContext.UserProfiles.AnyAsync(x => x.Id == followedId, cancellationToken);

        if (!profilesExist)
        {
            return false;
        }

        dbContext.Follows.Add(new Follow
        {
            FollowerId = followerId,
            FollowedId = followedId,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> UnfollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default)
    {
        var follow = await dbContext.Follows.FirstOrDefaultAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId,
            cancellationToken);

        if (follow is null)
        {
            return false;
        }

        dbContext.Follows.Remove(follow);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> IsFollowingAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default)
    {
        return await dbContext.Follows.AnyAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId,
            cancellationToken);
    }

    public async Task<IReadOnlyCollection<ProfileDto>> GetFollowingAsync(Guid followerId, int take = 100, CancellationToken cancellationToken = default)
    {
        var normalizedTake = Math.Clamp(take, 1, 200);

        return await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == followerId)
            .Include(x => x.Followed)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(normalizedTake)
            .Select(x => new ProfileDto(
                x.Followed.Id,
                x.Followed.Handle,
                x.Followed.DisplayName,
                x.Followed.Bio,
                x.Followed.ImageUrl,
                x.Followed.CreatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    public async Task<FollowSuggestionsDto> GetSuggestionsAsync(Guid followerId, int takePerGroup = 10, CancellationToken cancellationToken = default)
    {
        var normalizedTake = Math.Clamp(takePerGroup, 1, 20);

        var following = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == followerId)
            .Include(x => x.Followed)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(normalizedTake)
            .Select(x => new ProfileDto(
                x.Followed.Id,
                x.Followed.Handle,
                x.Followed.DisplayName,
                x.Followed.Bio,
                x.Followed.ImageUrl,
                x.Followed.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        var followingIds = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == followerId)
            .Select(x => x.FollowedId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (followingIds.Count == 0)
        {
            return new FollowSuggestionsDto(following, Array.Empty<ProfileDto>());
        }

        var secondDegreeCandidates = await dbContext.Follows
            .AsNoTracking()
            .Where(x => followingIds.Contains(x.FollowerId))
            .Where(x => x.FollowedId != followerId && !followingIds.Contains(x.FollowedId))
            .GroupBy(x => x.FollowedId)
            .Select(group => new
            {
                ProfileId = group.Key,
                MutualCount = group.Select(x => x.FollowerId).Distinct().Count(),
                LastFollowedAtUtc = group.Max(x => x.CreatedAtUtc)
            })
            .OrderByDescending(x => x.MutualCount)
            .ThenByDescending(x => x.LastFollowedAtUtc)
            .Take(normalizedTake)
            .ToListAsync(cancellationToken);

        var candidateIds = secondDegreeCandidates.Select(x => x.ProfileId).ToList();
        if (candidateIds.Count == 0)
        {
            return new FollowSuggestionsDto(following, Array.Empty<ProfileDto>());
        }

        var candidateProfiles = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => candidateIds.Contains(x.Id))
            .Select(x => new ProfileDto(
                x.Id,
                x.Handle,
                x.DisplayName,
                x.Bio,
                x.ImageUrl,
                x.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        var orderedRelevant = secondDegreeCandidates
            .Join(
                candidateProfiles,
                ranking => ranking.ProfileId,
                profile => profile.Id,
                (_, profile) => profile)
            .ToList();

        return new FollowSuggestionsDto(following, orderedRelevant);
    }
}
