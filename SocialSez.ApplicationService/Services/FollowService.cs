using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
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
}
