using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class FollowService(SocialSezContext dbContext) : IFollowService
{
    public async Task<FollowActionResultDto> FollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default)
    {
        if (followerId == followedId)
        {
            return new FollowActionResultDto(FollowActionStatuses.Invalid);
        }

        var exists = await dbContext.Follows.AnyAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId,
            cancellationToken);

        if (exists)
        {
            return new FollowActionResultDto(FollowActionStatuses.AlreadyFollowing);
        }

        var follower = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == followerId, cancellationToken);

        var followed = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == followedId, cancellationToken);

        if (follower is null || followed is null)
        {
            return new FollowActionResultDto(FollowActionStatuses.Invalid);
        }

        var existingRequest = await dbContext.ProfileFollowRequests
            .FirstOrDefaultAsync(x => x.FollowerId == followerId && x.FollowedId == followedId, cancellationToken);

        if (followed.IsPrivate)
        {
            if (existingRequest is not null && string.Equals(existingRequest.Status, "Pending", StringComparison.OrdinalIgnoreCase))
            {
                return new FollowActionResultDto(FollowActionStatuses.AlreadyRequested);
            }

            await RemoveFollowRequestNotificationsAsync(followerId, followedId, cancellationToken);

            if (existingRequest is null)
            {
                dbContext.ProfileFollowRequests.Add(new ProfileFollowRequest
                {
                    FollowerId = followerId,
                    FollowedId = followedId,
                    CreatedAtUtc = DateTime.UtcNow,
                    Status = "Pending",
                    RespondedAtUtc = null
                });
            }
            else
            {
                existingRequest.Status = "Pending";
                existingRequest.CreatedAtUtc = DateTime.UtcNow;
                existingRequest.RespondedAtUtc = null;
            }

            dbContext.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                RecipientId = followedId,
                ActorId = followerId,
                Type = "FollowRequest",
                Message = $"@{follower.Handle} requested to follow you.",
                ReferenceId = followerId.ToString(),
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow
            });

            await dbContext.SaveChangesAsync(cancellationToken);
            return new FollowActionResultDto(FollowActionStatuses.RequestPending);
        }

        dbContext.Follows.Add(new Follow
        {
            FollowerId = followerId,
            FollowedId = followedId,
            CreatedAtUtc = DateTime.UtcNow
        });

        if (existingRequest is not null)
        {
            dbContext.ProfileFollowRequests.Remove(existingRequest);
        }

        dbContext.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            RecipientId = followedId,
            ActorId = followerId,
            Type = "Follow",
            Message = $"@{follower.Handle} started following you.",
            ReferenceId = followerId.ToString(),
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return new FollowActionResultDto(FollowActionStatuses.Followed);
    }

    public async Task<bool> UnfollowAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default)
    {
        var follow = await dbContext.Follows.FirstOrDefaultAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId,
            cancellationToken);

        var request = await dbContext.ProfileFollowRequests.FirstOrDefaultAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId && x.Status == "Pending",
            cancellationToken);

        if (follow is null && request is null)
        {
            return false;
        }

        if (follow is not null)
        {
            dbContext.Follows.Remove(follow);
        }

        if (request is not null)
        {
            dbContext.ProfileFollowRequests.Remove(request);
            await RemoveFollowRequestNotificationsAsync(followerId, followedId, cancellationToken);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> IsFollowingAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default)
    {
        return await dbContext.Follows.AnyAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId,
            cancellationToken);
    }

    public async Task<FollowStatusDto> GetStatusAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken = default)
    {
        var isFollowing = await IsFollowingAsync(followerId, followedId, cancellationToken);
        var isRequested = await dbContext.ProfileFollowRequests.AnyAsync(
            x => x.FollowerId == followerId && x.FollowedId == followedId && x.Status == "Pending",
            cancellationToken);

        var requiresApproval = await dbContext.UserProfiles
            .Where(x => x.Id == followedId)
            .Select(x => x.IsPrivate)
            .FirstOrDefaultAsync(cancellationToken);

        return new FollowStatusDto(isFollowing, isRequested, requiresApproval);
    }

    public async Task<IReadOnlyCollection<FollowRequestDto>> GetIncomingRequestsAsync(Guid profileId, int take = 50, CancellationToken cancellationToken = default)
    {
        var normalizedTake = Math.Clamp(take, 1, 200);

        return await dbContext.ProfileFollowRequests
            .AsNoTracking()
            .Where(x => x.FollowedId == profileId && x.Status == "Pending")
            .Include(x => x.Follower)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(normalizedTake)
            .Select(x => new FollowRequestDto(
                x.FollowerId,
                x.Follower.Handle,
                x.Follower.ImageUrl,
                x.CreatedAtUtc,
                x.Status))
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> ApproveRequestAsync(Guid profileId, Guid followerId, CancellationToken cancellationToken = default)
    {
        var request = await dbContext.ProfileFollowRequests
            .Include(x => x.Follower)
            .FirstOrDefaultAsync(x => x.FollowerId == followerId && x.FollowedId == profileId && x.Status == "Pending", cancellationToken);

        if (request is null)
        {
            return false;
        }

        var alreadyFollowing = await dbContext.Follows.AnyAsync(x => x.FollowerId == followerId && x.FollowedId == profileId, cancellationToken);
        if (!alreadyFollowing)
        {
            dbContext.Follows.Add(new Follow
            {
                FollowerId = followerId,
                FollowedId = profileId,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        request.Status = "Approved";
        request.RespondedAtUtc = DateTime.UtcNow;

        await RemoveFollowRequestNotificationsAsync(followerId, profileId, cancellationToken);

        dbContext.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            RecipientId = profileId,
            ActorId = followerId,
            Type = "Follow",
            Message = $"@{request.Follower.Handle} is now following you.",
            ReferenceId = followerId.ToString(),
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow
        });

        dbContext.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            RecipientId = followerId,
            ActorId = profileId,
            Type = "FollowRequestApproved",
            Message = "Your follow request was approved.",
            ReferenceId = profileId.ToString(),
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> DeclineRequestAsync(Guid profileId, Guid followerId, CancellationToken cancellationToken = default)
    {
        var request = await dbContext.ProfileFollowRequests
            .FirstOrDefaultAsync(x => x.FollowerId == followerId && x.FollowedId == profileId && x.Status == "Pending", cancellationToken);

        if (request is null)
        {
            return false;
        }

        request.Status = "Declined";
        request.RespondedAtUtc = DateTime.UtcNow;

        await RemoveFollowRequestNotificationsAsync(followerId, profileId, cancellationToken);

        dbContext.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            RecipientId = followerId,
            ActorId = profileId,
            Type = "FollowRequestDeclined",
            Message = "Your follow request was declined.",
            ReferenceId = profileId.ToString(),
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task RemoveFollowRequestNotificationsAsync(Guid followerId, Guid followedId, CancellationToken cancellationToken)
    {
        var notifications = await dbContext.Notifications
            .Where(x => x.Type == "FollowRequest" && x.RecipientId == followedId && x.ActorId == followerId)
            .ToListAsync(cancellationToken);

        if (notifications.Count > 0)
        {
            dbContext.Notifications.RemoveRange(notifications);
        }
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
                x.Followed.IsPrivate,
                x.Followed.CreatedAtUtc,
                null))
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
                x.Followed.IsPrivate,
                x.Followed.CreatedAtUtc,
                null))
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
                x.IsPrivate,
                x.CreatedAtUtc,
                null))
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
