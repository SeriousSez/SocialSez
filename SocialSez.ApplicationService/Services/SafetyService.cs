using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class SafetyService(SocialSezContext dbContext) : ISafetyService
{
    public async Task<SafetyStatusDto> GetStatusAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        var isBlocked = await dbContext.UserBlocks
            .AsNoTracking()
            .AnyAsync(x => x.BlockerId == actorProfileId && x.BlockedId == targetProfileId, cancellationToken);

        var isBlockedByTarget = await dbContext.UserBlocks
            .AsNoTracking()
            .AnyAsync(x => x.BlockerId == targetProfileId && x.BlockedId == actorProfileId, cancellationToken);

        var isMuted = await dbContext.UserMutes
            .AsNoTracking()
            .AnyAsync(x => x.MuterId == actorProfileId && x.MutedId == targetProfileId, cancellationToken);

        return new SafetyStatusDto(isBlocked, isMuted, isBlockedByTarget);
    }

    public async Task<IReadOnlyCollection<ProfileDto>> GetBlockedProfilesAsync(Guid actorProfileId, int take = 100, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 250);

        return await dbContext.UserBlocks
            .AsNoTracking()
            .Where(x => x.BlockerId == actorProfileId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => new ProfileDto(
                x.Blocked.Id,
                x.Blocked.Handle,
                x.Blocked.DisplayName,
                x.Blocked.Bio,
                x.Blocked.ImageUrl,
                x.Blocked.IsPrivate,
                x.Blocked.CreatedAtUtc,
                null))
            .Take(take)
            .ToArrayAsync(cancellationToken);
    }

    public async Task<bool> BlockAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        if (actorProfileId == targetProfileId)
        {
            return false;
        }

        var profilesExist = await dbContext.UserProfiles
            .Where(x => x.Id == actorProfileId || x.Id == targetProfileId)
            .Select(x => x.Id)
            .Distinct()
            .CountAsync(cancellationToken) == 2;

        if (!profilesExist)
        {
            return false;
        }

        var existingBlock = await dbContext.UserBlocks
            .FirstOrDefaultAsync(x => x.BlockerId == actorProfileId && x.BlockedId == targetProfileId, cancellationToken);

        if (existingBlock is null)
        {
            dbContext.UserBlocks.Add(new UserBlock
            {
                BlockerId = actorProfileId,
                BlockedId = targetProfileId,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        await RemoveFollowGraphAsync(actorProfileId, targetProfileId, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> UnblockAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        var block = await dbContext.UserBlocks
            .FirstOrDefaultAsync(x => x.BlockerId == actorProfileId && x.BlockedId == targetProfileId, cancellationToken);

        if (block is null)
        {
            return false;
        }

        dbContext.UserBlocks.Remove(block);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> MuteAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        if (actorProfileId == targetProfileId)
        {
            return false;
        }

        var profilesExist = await dbContext.UserProfiles
            .Where(x => x.Id == actorProfileId || x.Id == targetProfileId)
            .Select(x => x.Id)
            .Distinct()
            .CountAsync(cancellationToken) == 2;

        if (!profilesExist)
        {
            return false;
        }

        var existingMute = await dbContext.UserMutes
            .FirstOrDefaultAsync(x => x.MuterId == actorProfileId && x.MutedId == targetProfileId, cancellationToken);

        if (existingMute is null)
        {
            dbContext.UserMutes.Add(new UserMute
            {
                MuterId = actorProfileId,
                MutedId = targetProfileId,
                CreatedAtUtc = DateTime.UtcNow
            });
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return true;
    }

    public async Task<bool> UnmuteAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        var mute = await dbContext.UserMutes
            .FirstOrDefaultAsync(x => x.MuterId == actorProfileId && x.MutedId == targetProfileId, cancellationToken);

        if (mute is null)
        {
            return false;
        }

        dbContext.UserMutes.Remove(mute);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> ReportAsync(Guid actorProfileId, Guid targetProfileId, ReportProfileRequestDto request, CancellationToken cancellationToken = default)
    {
        return await CreateReportAsync(actorProfileId, targetProfileId, null, null, null, null, null, null, request.Reason, request.Details, cancellationToken);
    }

    public async Task<bool> ReportPostAsync(Guid actorProfileId, Guid targetPostId, ReportContentRequestDto request, CancellationToken cancellationToken = default)
    {
        var post = await dbContext.Posts
            .AsNoTracking()
            .Where(x => x.Id == targetPostId)
            .Select(x => new { x.Id, x.AuthorId })
            .FirstOrDefaultAsync(cancellationToken);

        if (post is null)
        {
            return false;
        }

        return await CreateReportAsync(actorProfileId, post.AuthorId, post.Id, null, null, null, null, null, request.Reason, request.Details, cancellationToken);
    }

    public async Task<bool> ReportReelAsync(Guid actorProfileId, Guid targetReelId, ReportContentRequestDto request, CancellationToken cancellationToken = default)
    {
        var reel = await dbContext.Reels
            .AsNoTracking()
            .Where(x => x.Id == targetReelId)
            .Select(x => new { x.Id, x.AuthorId })
            .FirstOrDefaultAsync(cancellationToken);

        if (reel is null)
        {
            return false;
        }

        return await CreateReportAsync(actorProfileId, reel.AuthorId, null, reel.Id, null, null, null, null, request.Reason, request.Details, cancellationToken);
    }

    public async Task<bool> ReportStoryAsync(Guid actorProfileId, Guid targetStoryId, ReportContentRequestDto request, CancellationToken cancellationToken = default)
    {
        var story = await dbContext.Stories
            .AsNoTracking()
            .Where(x => x.Id == targetStoryId)
            .Select(x => new { x.Id, x.AuthorId })
            .FirstOrDefaultAsync(cancellationToken);

        if (story is null)
        {
            return false;
        }

        return await CreateReportAsync(actorProfileId, story.AuthorId, null, null, story.Id, null, null, null, request.Reason, request.Details, cancellationToken);
    }

    public async Task<bool> ReportCommentAsync(Guid actorProfileId, Guid targetCommentId, ReportContentRequestDto request, CancellationToken cancellationToken = default)
    {
        var comment = await dbContext.Comments
            .AsNoTracking()
            .Where(x => x.Id == targetCommentId)
            .Select(x => new { x.Id, x.AuthorId })
            .FirstOrDefaultAsync(cancellationToken);

        if (comment is null)
        {
            return false;
        }

        return await CreateReportAsync(actorProfileId, comment.AuthorId, null, null, null, comment.Id, null, null, request.Reason, request.Details, cancellationToken);
    }

    public async Task<bool> ReportReelCommentAsync(Guid actorProfileId, Guid targetReelCommentId, ReportContentRequestDto request, CancellationToken cancellationToken = default)
    {
        var reelComment = await dbContext.ReelComments
            .AsNoTracking()
            .Where(x => x.Id == targetReelCommentId)
            .Select(x => new { x.Id, x.AuthorId })
            .FirstOrDefaultAsync(cancellationToken);

        if (reelComment is null)
        {
            return false;
        }

        return await CreateReportAsync(actorProfileId, reelComment.AuthorId, null, null, null, null, reelComment.Id, null, request.Reason, request.Details, cancellationToken);
    }

    public async Task<bool> ReportMessageAsync(Guid actorProfileId, Guid targetMessageId, ReportContentRequestDto request, CancellationToken cancellationToken = default)
    {
        var message = await dbContext.ChatMessages
            .AsNoTracking()
            .Where(x => x.Id == targetMessageId)
            .Select(x => new { x.Id, x.AuthorProfileId })
            .FirstOrDefaultAsync(cancellationToken);

        if (message is null)
        {
            return false;
        }

        return await CreateReportAsync(actorProfileId, message.AuthorProfileId, null, null, null, null, null, message.Id, request.Reason, request.Details, cancellationToken);
    }

    private async Task<bool> CreateReportAsync(
        Guid actorProfileId,
        Guid targetProfileId,
        Guid? targetPostId,
        Guid? targetReelId,
        Guid? targetStoryId,
        Guid? targetCommentId,
        Guid? targetReelCommentId,
        Guid? targetMessageId,
        string? reasonInput,
        string? detailsInput,
        CancellationToken cancellationToken)
    {
        if (actorProfileId == targetProfileId)
        {
            return false;
        }

        var reason = reasonInput?.Trim() ?? string.Empty;
        var details = detailsInput?.Trim();

        if (string.IsNullOrWhiteSpace(reason))
        {
            return false;
        }

        var profilesExist = await dbContext.UserProfiles
            .Where(x => x.Id == actorProfileId || x.Id == targetProfileId)
            .Select(x => x.Id)
            .Distinct()
            .CountAsync(cancellationToken) == 2;

        if (!profilesExist)
        {
            return false;
        }

        dbContext.UserReports.Add(new UserReport
        {
            Id = Guid.NewGuid(),
            ReporterId = actorProfileId,
            TargetProfileId = targetProfileId,
            TargetPostId = targetPostId,
            TargetReelId = targetReelId,
            TargetStoryId = targetStoryId,
            TargetCommentId = targetCommentId,
            TargetReelCommentId = targetReelCommentId,
            TargetMessageId = targetMessageId,
            Reason = reason.Length > 100 ? reason[..100] : reason,
            Details = string.IsNullOrWhiteSpace(details)
                ? null
                : (details.Length > 1000 ? details[..1000] : details),
            Status = "Open",
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task RemoveFollowGraphAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken)
    {
        var follows = await dbContext.Follows
            .Where(x =>
                (x.FollowerId == actorProfileId && x.FollowedId == targetProfileId)
                || (x.FollowerId == targetProfileId && x.FollowedId == actorProfileId))
            .ToListAsync(cancellationToken);

        if (follows.Count > 0)
        {
            dbContext.Follows.RemoveRange(follows);
        }

        var requests = await dbContext.ProfileFollowRequests
            .Where(x =>
                (x.FollowerId == actorProfileId && x.FollowedId == targetProfileId)
                || (x.FollowerId == targetProfileId && x.FollowedId == actorProfileId))
            .ToListAsync(cancellationToken);

        if (requests.Count > 0)
        {
            dbContext.ProfileFollowRequests.RemoveRange(requests);
        }

        var notifications = await dbContext.Notifications
            .Where(x =>
                x.Type == "Follow" || x.Type == "FollowRequest" || x.Type == "FollowRequestApproved" || x.Type == "FollowRequestDeclined")
            .Where(x =>
                (x.RecipientId == actorProfileId && x.ActorId == targetProfileId)
                || (x.RecipientId == targetProfileId && x.ActorId == actorProfileId))
            .ToListAsync(cancellationToken);

        if (notifications.Count > 0)
        {
            dbContext.Notifications.RemoveRange(notifications);
        }
    }
}
