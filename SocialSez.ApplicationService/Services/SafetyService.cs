using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using System.Text.Json;
using System.Text.RegularExpressions;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class SafetyService(SocialSezContext dbContext) : ISafetyService
{
    private const string OwnerRole = "Owner";
    private const string AdminRole = "Admin";
    private const string ModeratorRole = "Moderator";
    private const string OpenStatus = "Open";
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool safetySchemaInitialized;
    private static readonly Regex UrlRegex = new(@"https?://\S+", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly string[] SuspiciousLinkTokens = ["bit.ly", "tinyurl.", "t.co/", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "lnk.to", "@", "%40"];
    private static readonly string[] SuspiciousTlds = [".zip", ".mov", ".click", ".xyz", ".top", ".gq", ".tk"];

    public async Task<SafetyStatusDto> GetStatusAsync(Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

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

    public async Task<ReputationScoreDto?> GetReputationScoreAsync(Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        var profile = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => x.Id == targetProfileId)
            .Select(x => new { x.Id, x.CreatedAtUtc })
            .FirstOrDefaultAsync(cancellationToken);

        if (profile is null)
        {
            return null;
        }

        var reportsOpen = await dbContext.UserReports
            .AsNoTracking()
            .CountAsync(x => x.TargetProfileId == targetProfileId && x.Status == OpenStatus, cancellationToken);

        var blocksReceived = await dbContext.UserBlocks
            .AsNoTracking()
            .CountAsync(x => x.BlockedId == targetProfileId, cancellationToken);

        var queueItemsOpen = await dbContext.ModerationQueueItems
            .AsNoTracking()
            .CountAsync(x => x.TargetProfileId == targetProfileId && x.Status == OpenStatus, cancellationToken);

        var ageDays = Math.Max(0, (DateTime.UtcNow - profile.CreatedAtUtc).Days);
        var ageBonus = Math.Min(10, ageDays / 45);

        var score = 100;
        score -= Math.Min(50, reportsOpen * 8);
        score -= Math.Min(30, blocksReceived / 2);
        score -= Math.Min(20, queueItemsOpen * 5);
        score += ageBonus;
        score = Math.Clamp(score, 0, 100);

        var riskLevel = score <= 40
            ? "High"
            : score <= 70
                ? "Medium"
                : "Low";

        return new ReputationScoreDto(
            targetProfileId,
            score,
            riskLevel,
            reportsOpen,
            blocksReceived,
            queueItemsOpen,
            DateTime.UtcNow);
    }

    public async Task<ContentModerationScanResultDto> ScanContentAsync(Guid actorProfileId, ContentModerationScanRequestDto request, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var throttleWindowStart = now.AddMinutes(-2);
        var recentQueueCount = await dbContext.ModerationQueueItems
            .AsNoTracking()
            .CountAsync(x => x.ReporterId == actorProfileId && x.CreatedAtUtc >= throttleWindowStart, cancellationToken);
        var isThrottled = recentQueueCount >= 6;
        var recommendedRetryAfterSeconds = isThrottled ? 120 : 0;

        var normalizedContent = (request.Content ?? string.Empty).Trim();
        var normalizedLink = (request.LinkUrl ?? string.Empty).Trim();
        var sourceType = NormalizeSourceType(request.SourceType);

        var setting = await GetOrCreateModerationSettingsEntityAsync(request.CommunityId, cancellationToken);
        var dtoSettings = setting is null
            ? BuildDefaultModerationSettingsDto(request.CommunityId)
            : MapModerationSettings(setting);

        var spamScore = ComputeSpamScore(normalizedContent, normalizedLink);
        var linkRiskScore = ComputeLinkRiskScore(normalizedLink);
        var matchedKeyword = FindKeywordMatch(normalizedContent, normalizedLink, dtoSettings.KeywordFilters);
        var riskScore = Math.Clamp((int)Math.Round((spamScore * 0.55) + (linkRiskScore * 0.45)), 0, 100);

        var shouldQueue = isThrottled || (dtoSettings.AutoModerationEnabled
            && (spamScore >= dtoSettings.SpamThreshold
                || linkRiskScore >= dtoSettings.LinkRiskThreshold
            || !string.IsNullOrWhiteSpace(matchedKeyword)));

        Guid? queueItemId = null;
        if (shouldQueue)
        {
            var queueItem = new ModerationQueueItem
            {
                Id = Guid.NewGuid(),
                CommunityId = request.CommunityId,
                ReporterId = actorProfileId,
                TargetProfileId = actorProfileId,
                SourceEntityId = request.SourceEntityId,
                SourceType = sourceType,
                TriggerType = isThrottled
                    ? "RateLimit"
                    : (string.IsNullOrWhiteSpace(matchedKeyword) ? "AutoScan" : "KeywordFilter"),
                SpamScore = spamScore,
                LinkRiskScore = linkRiskScore,
                RiskScore = riskScore,
                LinkUrl = Truncate(normalizedLink, 2048),
                MatchedKeyword = Truncate(matchedKeyword, 80),
                ContentSnippet = BuildSnippet(normalizedContent),
                Status = OpenStatus,
                CreatedAtUtc = DateTime.UtcNow
            };

            dbContext.ModerationQueueItems.Add(queueItem);
            await dbContext.SaveChangesAsync(cancellationToken);
            queueItemId = queueItem.Id;
        }

        return new ContentModerationScanResultDto(
            shouldQueue,
            isThrottled,
            recommendedRetryAfterSeconds,
            spamScore,
            linkRiskScore,
            riskScore,
            matchedKeyword,
            queueItemId,
            dtoSettings.RulePreset);
    }

    public async Task<IReadOnlyCollection<ProfileDto>> GetBlockedProfilesAsync(Guid actorProfileId, int take = 100, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);
        return await CreateReportAsync(actorProfileId, targetProfileId, null, null, null, null, null, null, request.Reason, request.Details, cancellationToken);
    }

    public async Task<bool> ReportPostAsync(Guid actorProfileId, Guid targetPostId, ReportContentRequestDto request, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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
        await EnsureSafetySchemaAsync(cancellationToken);

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

    public async Task<CommunityModerationSettingsDto?> GetCommunityModerationSettingsAsync(Guid communityId, Guid actorProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        await EnsureCanModerateCommunityAsync(communityId, actorProfileId, cancellationToken);

        var settings = await dbContext.CommunityModerationSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CommunityId == communityId, cancellationToken);

        return settings is null ? BuildDefaultModerationSettingsDto(communityId) : MapModerationSettings(settings);
    }

    public async Task<CommunityModerationSettingsDto?> UpdateCommunityModerationSettingsAsync(Guid communityId, Guid actorProfileId, UpdateCommunityModerationSettingsRequestDto request, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        await EnsureCanManageCommunityAsync(communityId, actorProfileId, cancellationToken);

        var communityExists = await dbContext.Communities.AnyAsync(x => x.Id == communityId, cancellationToken);
        if (!communityExists)
        {
            return null;
        }

        var settings = await dbContext.CommunityModerationSettings.FirstOrDefaultAsync(x => x.CommunityId == communityId, cancellationToken);
        if (settings is null)
        {
            settings = new CommunityModerationSetting
            {
                CommunityId = communityId
            };
            dbContext.CommunityModerationSettings.Add(settings);
        }

        var normalizedPreset = NormalizeRulePreset(request.RulePreset);
        var normalizedKeywordFilters = NormalizeKeywordFilters(request.KeywordFilters);

        settings.RulePreset = normalizedPreset;
        settings.AutoModerationEnabled = request.AutoModerationEnabled;
        settings.SpamThreshold = Math.Clamp(request.SpamThreshold, 0, 100);
        settings.LinkRiskThreshold = Math.Clamp(request.LinkRiskThreshold, 0, 100);
        settings.KeywordFiltersJson = SerializeKeywordFilters(normalizedKeywordFilters);
        settings.UpdatedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapModerationSettings(settings);
    }

    public async Task<IReadOnlyCollection<CommunityShadowMuteDto>> GetCommunityShadowMutesAsync(Guid communityId, Guid actorProfileId, int take = 100, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        await EnsureCanModerateCommunityAsync(communityId, actorProfileId, cancellationToken);
        take = Math.Clamp(take, 1, 250);

        return await dbContext.CommunityShadowMutes
            .AsNoTracking()
            .Where(x => x.CommunityId == communityId)
            .Include(x => x.Profile)
            .Include(x => x.CreatedByProfile)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .Select(x => new CommunityShadowMuteDto(
                x.CommunityId,
                x.ProfileId,
                x.Profile.Handle,
                x.Reason,
                x.CreatedAtUtc,
                x.ExpiresAtUtc,
                x.CreatedByProfileId,
                x.CreatedByProfile.Handle))
            .ToArrayAsync(cancellationToken);
    }

    public async Task<CommunityShadowMuteDto?> AddCommunityShadowMuteAsync(Guid communityId, Guid actorProfileId, CreateCommunityShadowMuteRequestDto request, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        await EnsureCanModerateCommunityAsync(communityId, actorProfileId, cancellationToken);

        if (request.TargetProfileId == Guid.Empty || request.TargetProfileId == actorProfileId)
        {
            throw new ArgumentException("Target profile is invalid.", nameof(request));
        }

        var targetProfile = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => x.Id == request.TargetProfileId)
            .Select(x => new { x.Id, x.Handle })
            .FirstOrDefaultAsync(cancellationToken);

        var actorProfile = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => x.Id == actorProfileId)
            .Select(x => new { x.Id, x.Handle })
            .FirstOrDefaultAsync(cancellationToken);

        if (targetProfile is null || actorProfile is null)
        {
            return null;
        }

        var now = DateTime.UtcNow;
        var existing = await dbContext.CommunityShadowMutes
            .FirstOrDefaultAsync(x => x.CommunityId == communityId && x.ProfileId == request.TargetProfileId, cancellationToken);

        if (existing is null)
        {
            existing = new CommunityShadowMute
            {
                CommunityId = communityId,
                ProfileId = request.TargetProfileId,
                CreatedAtUtc = now
            };
            dbContext.CommunityShadowMutes.Add(existing);
        }

        existing.CreatedByProfileId = actorProfileId;
        existing.Reason = Truncate(request.Reason?.Trim(), 300);
        existing.ExpiresAtUtc = request.ExpiresAtUtc;

        await dbContext.SaveChangesAsync(cancellationToken);

        return new CommunityShadowMuteDto(
            communityId,
            targetProfile.Id,
            targetProfile.Handle,
            existing.Reason,
            existing.CreatedAtUtc,
            existing.ExpiresAtUtc,
            actorProfile.Id,
            actorProfile.Handle);
    }

    public async Task<bool> RemoveCommunityShadowMuteAsync(Guid communityId, Guid actorProfileId, Guid targetProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        await EnsureCanModerateCommunityAsync(communityId, actorProfileId, cancellationToken);

        var existing = await dbContext.CommunityShadowMutes
            .FirstOrDefaultAsync(x => x.CommunityId == communityId && x.ProfileId == targetProfileId, cancellationToken);

        if (existing is null)
        {
            return false;
        }

        dbContext.CommunityShadowMutes.Remove(existing);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<CommunityBanAppealDto?> SubmitCommunityBanAppealAsync(Guid communityId, Guid actorProfileId, CreateCommunityBanAppealRequestDto request, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        var reason = request.Reason?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Reason is required.", nameof(request));
        }

        var communityExists = await dbContext.Communities.AnyAsync(x => x.Id == communityId, cancellationToken);
        if (!communityExists)
        {
            return null;
        }

        var profile = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => x.Id == actorProfileId)
            .Select(x => new { x.Id, x.Handle })
            .FirstOrDefaultAsync(cancellationToken);

        if (profile is null)
        {
            return null;
        }

        var existingOpen = await dbContext.CommunityBanAppeals
            .AsNoTracking()
            .AnyAsync(x => x.CommunityId == communityId && x.ProfileId == actorProfileId && x.Status == OpenStatus, cancellationToken);

        if (existingOpen)
        {
            throw new InvalidOperationException("An open appeal already exists for this community.");
        }

        var appeal = new CommunityBanAppeal
        {
            Id = Guid.NewGuid(),
            CommunityId = communityId,
            ProfileId = actorProfileId,
            Reason = Truncate(reason, 1000) ?? string.Empty,
            Status = OpenStatus,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.CommunityBanAppeals.Add(appeal);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new CommunityBanAppealDto(
            appeal.Id,
            communityId,
            profile.Id,
            profile.Handle,
            appeal.Reason,
            appeal.Status,
            null,
            null,
            null,
            appeal.CreatedAtUtc,
            null);
    }

    public async Task<IReadOnlyCollection<CommunityBanAppealDto>> GetCommunityBanAppealsAsync(Guid communityId, Guid actorProfileId, string? status = null, int take = 100, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        await EnsureCanModerateCommunityAsync(communityId, actorProfileId, cancellationToken);

        var normalizedStatus = NormalizeOptionalStatus(status);
        take = Math.Clamp(take, 1, 250);

        var query = dbContext.CommunityBanAppeals
            .AsNoTracking()
            .Include(x => x.Profile)
            .Include(x => x.ReviewedByProfile)
            .Where(x => x.CommunityId == communityId)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(normalizedStatus))
        {
            query = query.Where(x => x.Status == normalizedStatus);
        }

        return await query
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .Select(x => new CommunityBanAppealDto(
                x.Id,
                x.CommunityId,
                x.ProfileId,
                x.Profile.Handle,
                x.Reason,
                x.Status,
                x.ResolutionNote,
                x.ReviewedByProfileId,
                x.ReviewedByProfile != null ? x.ReviewedByProfile.Handle : null,
                x.CreatedAtUtc,
                x.ReviewedAtUtc))
            .ToArrayAsync(cancellationToken);
    }

    public async Task<CommunityBanAppealDto?> ResolveCommunityBanAppealAsync(Guid communityId, Guid actorProfileId, Guid appealId, ResolveCommunityBanAppealRequestDto request, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        await EnsureCanModerateCommunityAsync(communityId, actorProfileId, cancellationToken);

        var appeal = await dbContext.CommunityBanAppeals
            .Include(x => x.Profile)
            .Include(x => x.ReviewedByProfile)
            .FirstOrDefaultAsync(x => x.Id == appealId && x.CommunityId == communityId, cancellationToken);

        if (appeal is null)
        {
            return null;
        }

        appeal.Status = request.Approved ? "Approved" : "Rejected";
        appeal.ResolutionNote = Truncate(request.ResolutionNote?.Trim(), 1000);
        appeal.ReviewedByProfileId = actorProfileId;
        appeal.ReviewedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);

        string? reviewedByHandle = null;
        if (appeal.ReviewedByProfileId.HasValue)
        {
            reviewedByHandle = await dbContext.UserProfiles
                .AsNoTracking()
                .Where(x => x.Id == appeal.ReviewedByProfileId.Value)
                .Select(x => x.Handle)
                .FirstOrDefaultAsync(cancellationToken);
        }

        return new CommunityBanAppealDto(
            appeal.Id,
            appeal.CommunityId,
            appeal.ProfileId,
            appeal.Profile.Handle,
            appeal.Reason,
            appeal.Status,
            appeal.ResolutionNote,
            appeal.ReviewedByProfileId,
            reviewedByHandle,
            appeal.CreatedAtUtc,
            appeal.ReviewedAtUtc);
    }

    public async Task<IReadOnlyCollection<ModerationQueueItemDto>> GetModerationQueueAsync(Guid actorProfileId, Guid? communityId = null, string? status = "Open", int take = 100, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        take = Math.Clamp(take, 1, 250);
        var normalizedStatus = NormalizeOptionalStatus(status);

        var query = dbContext.ModerationQueueItems
            .AsNoTracking()
            .Include(x => x.Reporter)
            .Include(x => x.TargetProfile)
            .Include(x => x.ReviewedByProfile)
            .AsQueryable();

        if (communityId.HasValue)
        {
            await EnsureCanModerateCommunityAsync(communityId.Value, actorProfileId, cancellationToken);
            query = query.Where(x => x.CommunityId == communityId.Value);
        }
        else
        {
            var moderatedCommunityIds = await dbContext.CommunityMembers
                .AsNoTracking()
                .Where(x => x.ProfileId == actorProfileId && (x.Role == OwnerRole || x.Role == AdminRole || x.Role == ModeratorRole))
                .Select(x => x.CommunityId)
                .ToArrayAsync(cancellationToken);

            query = query.Where(x => (x.CommunityId.HasValue && moderatedCommunityIds.Contains(x.CommunityId.Value))
                || (!x.CommunityId.HasValue && x.ReporterId == actorProfileId));
        }

        if (!string.IsNullOrWhiteSpace(normalizedStatus))
        {
            query = query.Where(x => x.Status == normalizedStatus);
        }

        return await query
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .Select(x => new ModerationQueueItemDto(
                x.Id,
                x.CommunityId,
                x.ReporterId,
                x.Reporter != null ? x.Reporter.Handle : null,
                x.TargetProfileId,
                x.TargetProfile != null ? x.TargetProfile.Handle : null,
                x.SourceEntityId,
                x.SourceType,
                x.TriggerType,
                x.SpamScore,
                x.LinkRiskScore,
                x.RiskScore,
                x.LinkUrl,
                x.MatchedKeyword,
                x.ContentSnippet,
                x.Status,
                x.Resolution,
                x.ResolutionNote,
                x.ReviewedByProfileId,
                x.ReviewedByProfile != null ? x.ReviewedByProfile.Handle : null,
                x.CreatedAtUtc,
                x.ReviewedAtUtc))
            .ToArrayAsync(cancellationToken);
    }

    public async Task<ModerationQueueItemDto?> ResolveModerationQueueItemAsync(Guid queueItemId, Guid actorProfileId, ResolveModerationQueueItemRequestDto request, CancellationToken cancellationToken = default)
    {
        await EnsureSafetySchemaAsync(cancellationToken);

        var queueItem = await dbContext.ModerationQueueItems
            .Include(x => x.Reporter)
            .Include(x => x.TargetProfile)
            .Include(x => x.ReviewedByProfile)
            .FirstOrDefaultAsync(x => x.Id == queueItemId, cancellationToken);

        if (queueItem is null)
        {
            return null;
        }

        if (queueItem.CommunityId.HasValue)
        {
            await EnsureCanModerateCommunityAsync(queueItem.CommunityId.Value, actorProfileId, cancellationToken);
        }
        else if (queueItem.ReporterId != actorProfileId)
        {
            throw new UnauthorizedAccessException("Only the reporter can resolve this queue item.");
        }

        var resolution = NormalizeResolution(request.Resolution);
        queueItem.Status = "Resolved";
        queueItem.Resolution = resolution;
        queueItem.ResolutionNote = Truncate(request.ResolutionNote?.Trim(), 1000);
        queueItem.ReviewedByProfileId = actorProfileId;
        queueItem.ReviewedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);

        string? reviewedByHandle = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => x.Id == actorProfileId)
            .Select(x => x.Handle)
            .FirstOrDefaultAsync(cancellationToken);

        return new ModerationQueueItemDto(
            queueItem.Id,
            queueItem.CommunityId,
            queueItem.ReporterId,
            queueItem.Reporter?.Handle,
            queueItem.TargetProfileId,
            queueItem.TargetProfile?.Handle,
            queueItem.SourceEntityId,
            queueItem.SourceType,
            queueItem.TriggerType,
            queueItem.SpamScore,
            queueItem.LinkRiskScore,
            queueItem.RiskScore,
            queueItem.LinkUrl,
            queueItem.MatchedKeyword,
            queueItem.ContentSnippet,
            queueItem.Status,
            queueItem.Resolution,
            queueItem.ResolutionNote,
            queueItem.ReviewedByProfileId,
            reviewedByHandle,
            queueItem.CreatedAtUtc,
            queueItem.ReviewedAtUtc);
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

        var report = new UserReport
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
        };

        dbContext.UserReports.Add(report);

        dbContext.ModerationQueueItems.Add(new ModerationQueueItem
        {
            Id = Guid.NewGuid(),
            ReporterId = actorProfileId,
            TargetProfileId = targetProfileId,
            SourceEntityId = targetPostId ?? targetReelId ?? targetStoryId ?? targetCommentId ?? targetReelCommentId ?? targetMessageId,
            SourceType = BuildSourceType(targetPostId, targetReelId, targetStoryId, targetCommentId, targetReelCommentId, targetMessageId),
            TriggerType = "UserReport",
            SpamScore = 0,
            LinkRiskScore = 0,
            RiskScore = 60,
            ContentSnippet = BuildSnippet(details ?? reason),
            Status = OpenStatus,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static string BuildSourceType(Guid? targetPostId, Guid? targetReelId, Guid? targetStoryId, Guid? targetCommentId, Guid? targetReelCommentId, Guid? targetMessageId)
    {
        if (targetPostId.HasValue)
        {
            return "Post";
        }

        if (targetReelId.HasValue)
        {
            return "Reel";
        }

        if (targetStoryId.HasValue)
        {
            return "Story";
        }

        if (targetCommentId.HasValue)
        {
            return "Comment";
        }

        if (targetReelCommentId.HasValue)
        {
            return "ReelComment";
        }

        if (targetMessageId.HasValue)
        {
            return "Message";
        }

        return "Profile";
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

    private async Task<CommunityModerationSetting?> GetOrCreateModerationSettingsEntityAsync(Guid? communityId, CancellationToken cancellationToken)
    {
        if (!communityId.HasValue)
        {
            return null;
        }

        var communityExists = await dbContext.Communities
            .AsNoTracking()
            .AnyAsync(x => x.Id == communityId.Value, cancellationToken);

        if (!communityExists)
        {
            return null;
        }

        var existing = await dbContext.CommunityModerationSettings
            .FirstOrDefaultAsync(x => x.CommunityId == communityId.Value, cancellationToken);

        if (existing is not null)
        {
            return existing;
        }

        var created = new CommunityModerationSetting
        {
            CommunityId = communityId.Value,
            RulePreset = "Balanced",
            AutoModerationEnabled = true,
            SpamThreshold = 65,
            LinkRiskThreshold = 60,
            KeywordFiltersJson = "[]",
            UpdatedAtUtc = DateTime.UtcNow
        };

        dbContext.CommunityModerationSettings.Add(created);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return created;
        }
        catch (DbUpdateException)
        {
            // Another concurrent request created the row first.
            return await dbContext.CommunityModerationSettings
                .FirstOrDefaultAsync(x => x.CommunityId == communityId.Value, cancellationToken);
        }
    }

    private static CommunityModerationSettingsDto BuildDefaultModerationSettingsDto(Guid? communityId)
    {
        return new CommunityModerationSettingsDto(
            communityId ?? Guid.Empty,
            "Balanced",
            true,
            65,
            60,
            Array.Empty<string>(),
            DateTime.UtcNow);
    }

    private static CommunityModerationSettingsDto MapModerationSettings(CommunityModerationSetting settings)
    {
        return new CommunityModerationSettingsDto(
            settings.CommunityId,
            settings.RulePreset,
            settings.AutoModerationEnabled,
            Math.Clamp(settings.SpamThreshold, 0, 100),
            Math.Clamp(settings.LinkRiskThreshold, 0, 100),
            DeserializeKeywordFilters(settings.KeywordFiltersJson),
            settings.UpdatedAtUtc);
    }

    private static int ComputeSpamScore(string content, string linkUrl)
    {
        if (string.IsNullOrWhiteSpace(content) && string.IsNullOrWhiteSpace(linkUrl))
        {
            return 0;
        }

        var score = 0;
        var normalized = content.Trim();
        var lower = normalized.ToLowerInvariant();

        if (normalized.Length > 1500)
        {
            score += 12;
        }

        var exclamationCount = normalized.Count(c => c == '!');
        if (exclamationCount >= 5)
        {
            score += 10;
        }

        var upperLetters = normalized.Count(char.IsLetter);
        if (upperLetters > 0)
        {
            var uppercaseRatio = normalized.Count(char.IsUpper) / (double)upperLetters;
            if (uppercaseRatio > 0.65)
            {
                score += 15;
            }
        }

        if (Regex.IsMatch(lower, @"(.)\1{6,}"))
        {
            score += 15;
        }

        if (Regex.IsMatch(lower, @"\b(free|guaranteed|urgent|act now|limited time|crypto giveaway|dm me now)\b", RegexOptions.IgnoreCase))
        {
            score += 22;
        }

        var linksInContent = UrlRegex.Matches(content).Count;
        if (!string.IsNullOrWhiteSpace(linkUrl))
        {
            linksInContent += 1;
        }

        if (linksInContent >= 3)
        {
            score += 25;
        }
        else if (linksInContent == 2)
        {
            score += 12;
        }

        return Math.Clamp(score, 0, 100);
    }

    private static int ComputeLinkRiskScore(string linkUrl)
    {
        if (string.IsNullOrWhiteSpace(linkUrl))
        {
            return 0;
        }

        var score = 0;
        var lower = linkUrl.Trim().ToLowerInvariant();

        if (!Uri.TryCreate(linkUrl, UriKind.Absolute, out var parsed))
        {
            return 70;
        }

        if (!string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            score += 20;
        }

        foreach (var token in SuspiciousLinkTokens)
        {
            if (lower.Contains(token, StringComparison.Ordinal))
            {
                score += 15;
            }
        }

        foreach (var tld in SuspiciousTlds)
        {
            if (parsed.Host.EndsWith(tld, StringComparison.OrdinalIgnoreCase))
            {
                score += 22;
            }
        }

        if (Regex.IsMatch(parsed.Host, @"^\d+\.\d+\.\d+\.\d+$"))
        {
            score += 25;
        }

        if (parsed.Host.Contains("xn--", StringComparison.OrdinalIgnoreCase))
        {
            score += 20;
        }

        return Math.Clamp(score, 0, 100);
    }

    private static string? FindKeywordMatch(string content, string linkUrl, IReadOnlyCollection<string> keywordFilters)
    {
        if (keywordFilters.Count == 0)
        {
            return null;
        }

        var haystack = $"{content} {linkUrl}".ToLowerInvariant();
        foreach (var keyword in keywordFilters)
        {
            var normalized = keyword.Trim().ToLowerInvariant();
            if (normalized.Length == 0)
            {
                continue;
            }

            if (haystack.Contains(normalized, StringComparison.Ordinal))
            {
                return keyword;
            }
        }

        return null;
    }

    private static string? BuildSnippet(string? content)
    {
        return Truncate(content?.Trim(), 500);
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static IReadOnlyCollection<string> NormalizeKeywordFilters(IReadOnlyCollection<string>? keywordFilters)
    {
        if (keywordFilters is null || keywordFilters.Count == 0)
        {
            return Array.Empty<string>();
        }

        return keywordFilters
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(200)
            .Select(x => x.Length > 80 ? x[..80] : x)
            .ToArray();
    }

    private static string SerializeKeywordFilters(IReadOnlyCollection<string> keywordFilters)
    {
        return JsonSerializer.Serialize(keywordFilters);
    }

    private static IReadOnlyCollection<string> DeserializeKeywordFilters(string? keywordFiltersJson)
    {
        if (string.IsNullOrWhiteSpace(keywordFiltersJson))
        {
            return Array.Empty<string>();
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<string[]>(keywordFiltersJson);
            return NormalizeKeywordFilters(parsed);
        }
        catch (JsonException)
        {
            return Array.Empty<string>();
        }
    }

    private static string NormalizeRulePreset(string? input)
    {
        var normalized = (input ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Rule preset is required.", nameof(input));
        }

        if (string.Equals(normalized, "Strict", StringComparison.OrdinalIgnoreCase))
        {
            return "Strict";
        }

        if (string.Equals(normalized, "Lenient", StringComparison.OrdinalIgnoreCase))
        {
            return "Lenient";
        }

        return "Balanced";
    }

    private static string NormalizeSourceType(string? input)
    {
        var normalized = (input ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "Content";
        }

        return normalized.Length > 40 ? normalized[..40] : normalized;
    }

    private static string NormalizeResolution(string? input)
    {
        var normalized = (input ?? string.Empty).Trim();
        if (string.Equals(normalized, "Allow", StringComparison.OrdinalIgnoreCase))
        {
            return "Allow";
        }

        if (string.Equals(normalized, "Remove", StringComparison.OrdinalIgnoreCase))
        {
            return "Remove";
        }

        if (string.Equals(normalized, "Escalate", StringComparison.OrdinalIgnoreCase))
        {
            return "Escalate";
        }

        if (string.Equals(normalized, "Dismiss", StringComparison.OrdinalIgnoreCase))
        {
            return "Dismiss";
        }

        throw new ArgumentException("Resolution must be one of: Allow, Remove, Escalate, Dismiss.", nameof(input));
    }

    private static string? NormalizeOptionalStatus(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var normalized = input.Trim();
        if (string.Equals(normalized, "Open", StringComparison.OrdinalIgnoreCase))
        {
            return "Open";
        }

        if (string.Equals(normalized, "Resolved", StringComparison.OrdinalIgnoreCase))
        {
            return "Resolved";
        }

        if (string.Equals(normalized, "Approved", StringComparison.OrdinalIgnoreCase))
        {
            return "Approved";
        }

        if (string.Equals(normalized, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            return "Rejected";
        }

        throw new ArgumentException("Status is invalid.", nameof(input));
    }

    private async Task EnsureCanModerateCommunityAsync(Guid communityId, Guid actorProfileId, CancellationToken cancellationToken)
    {
        var membership = await dbContext.CommunityMembers
            .AsNoTracking()
            .Where(x => x.CommunityId == communityId && x.ProfileId == actorProfileId)
            .Select(x => x.Role)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(membership)
            || (membership != OwnerRole && membership != AdminRole && membership != ModeratorRole))
        {
            throw new UnauthorizedAccessException("Only community moderators can perform this action.");
        }
    }

    private async Task EnsureCanManageCommunityAsync(Guid communityId, Guid actorProfileId, CancellationToken cancellationToken)
    {
        var membership = await dbContext.CommunityMembers
            .AsNoTracking()
            .Where(x => x.CommunityId == communityId && x.ProfileId == actorProfileId)
            .Select(x => x.Role)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(membership)
            || (membership != OwnerRole && membership != AdminRole))
        {
            throw new UnauthorizedAccessException("Only owners or admins can perform this action.");
        }
    }

    private async Task EnsureSafetySchemaAsync(CancellationToken cancellationToken)
    {
        if (safetySchemaInitialized)
        {
            return;
        }

        await SchemaInitLock.WaitAsync(cancellationToken);
        try
        {
            if (safetySchemaInitialized)
            {
                return;
            }

            if (dbContext.Database.IsSqlite())
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS ModerationQueueItems (
                        Id TEXT NOT NULL PRIMARY KEY,
                        CommunityId TEXT NULL,
                        ReporterId TEXT NULL,
                        TargetProfileId TEXT NULL,
                        SourceEntityId TEXT NULL,
                        SourceType TEXT NOT NULL,
                        TriggerType TEXT NOT NULL,
                        SpamScore INTEGER NOT NULL,
                        LinkRiskScore INTEGER NOT NULL,
                        RiskScore INTEGER NOT NULL,
                        LinkUrl TEXT NULL,
                        MatchedKeyword TEXT NULL,
                        ContentSnippet TEXT NULL,
                        Status TEXT NOT NULL,
                        Resolution TEXT NULL,
                        ResolutionNote TEXT NULL,
                        ReviewedByProfileId TEXT NULL,
                        CreatedAtUtc TEXT NOT NULL,
                        ReviewedAtUtc TEXT NULL,
                        FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE SET NULL,
                        FOREIGN KEY (ReporterId) REFERENCES UserProfiles (Id) ON DELETE SET NULL,
                        FOREIGN KEY (TargetProfileId) REFERENCES UserProfiles (Id) ON DELETE SET NULL,
                        FOREIGN KEY (ReviewedByProfileId) REFERENCES UserProfiles (Id) ON DELETE SET NULL
                    );
                    """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_ModerationQueueItems_CommunityId_Status_CreatedAtUtc ON ModerationQueueItems (CommunityId, Status, CreatedAtUtc);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_ModerationQueueItems_Status_CreatedAtUtc ON ModerationQueueItems (Status, CreatedAtUtc);", cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS CommunityModerationSettings (
                        CommunityId TEXT NOT NULL PRIMARY KEY,
                        RulePreset TEXT NOT NULL,
                        KeywordFiltersJson TEXT NULL,
                        AutoModerationEnabled INTEGER NOT NULL,
                        SpamThreshold INTEGER NOT NULL,
                        LinkRiskThreshold INTEGER NOT NULL,
                        UpdatedAtUtc TEXT NOT NULL,
                        FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE
                    );
                    """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS CommunityShadowMutes (
                        CommunityId TEXT NOT NULL,
                        ProfileId TEXT NOT NULL,
                        CreatedByProfileId TEXT NOT NULL,
                        Reason TEXT NULL,
                        CreatedAtUtc TEXT NOT NULL,
                        ExpiresAtUtc TEXT NULL,
                        PRIMARY KEY (CommunityId, ProfileId),
                        FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                        FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE,
                        FOREIGN KEY (CreatedByProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
                    );
                    """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityShadowMutes_ProfileId ON CommunityShadowMutes (ProfileId);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityShadowMutes_CommunityId_ExpiresAtUtc ON CommunityShadowMutes (CommunityId, ExpiresAtUtc);", cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS CommunityBanAppeals (
                        Id TEXT NOT NULL PRIMARY KEY,
                        CommunityId TEXT NOT NULL,
                        ProfileId TEXT NOT NULL,
                        Reason TEXT NOT NULL,
                        Status TEXT NOT NULL,
                        ResolutionNote TEXT NULL,
                        ReviewedByProfileId TEXT NULL,
                        CreatedAtUtc TEXT NOT NULL,
                        ReviewedAtUtc TEXT NULL,
                        FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                        FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE,
                        FOREIGN KEY (ReviewedByProfileId) REFERENCES UserProfiles (Id) ON DELETE SET NULL
                    );
                    """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityBanAppeals_CommunityId_Status_CreatedAtUtc ON CommunityBanAppeals (CommunityId, Status, CreatedAtUtc);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityBanAppeals_ProfileId_CreatedAtUtc ON CommunityBanAppeals (ProfileId, CreatedAtUtc);", cancellationToken);
            }
            else
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS `ModerationQueueItems` (
                        `Id` char(36) NOT NULL,
                        `CommunityId` char(36) NULL,
                        `ReporterId` char(36) NULL,
                        `TargetProfileId` char(36) NULL,
                        `SourceEntityId` char(36) NULL,
                        `SourceType` varchar(40) NOT NULL,
                        `TriggerType` varchar(40) NOT NULL,
                        `SpamScore` int NOT NULL,
                        `LinkRiskScore` int NOT NULL,
                        `RiskScore` int NOT NULL,
                        `LinkUrl` varchar(2048) NULL,
                        `MatchedKeyword` varchar(80) NULL,
                        `ContentSnippet` varchar(500) NULL,
                        `Status` varchar(24) NOT NULL,
                        `Resolution` varchar(32) NULL,
                        `ResolutionNote` varchar(1000) NULL,
                        `ReviewedByProfileId` char(36) NULL,
                        `CreatedAtUtc` datetime(6) NOT NULL,
                        `ReviewedAtUtc` datetime(6) NULL,
                        PRIMARY KEY (`Id`),
                        KEY `IX_ModerationQueueItems_CommunityId_Status_CreatedAtUtc` (`CommunityId`, `Status`, `CreatedAtUtc`),
                        KEY `IX_ModerationQueueItems_Status_CreatedAtUtc` (`Status`, `CreatedAtUtc`),
                        CONSTRAINT `FK_ModerationQueueItems_Communities_CommunityId` FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE SET NULL,
                        CONSTRAINT `FK_ModerationQueueItems_UserProfiles_ReporterId` FOREIGN KEY (`ReporterId`) REFERENCES `UserProfiles` (`Id`) ON DELETE SET NULL,
                        CONSTRAINT `FK_ModerationQueueItems_UserProfiles_TargetProfileId` FOREIGN KEY (`TargetProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE SET NULL,
                        CONSTRAINT `FK_ModerationQueueItems_UserProfiles_ReviewedByProfileId` FOREIGN KEY (`ReviewedByProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE SET NULL
                    );
                    """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS `CommunityModerationSettings` (
                        `CommunityId` char(36) NOT NULL,
                        `RulePreset` varchar(24) NOT NULL,
                        `KeywordFiltersJson` longtext NULL,
                        `AutoModerationEnabled` tinyint(1) NOT NULL,
                        `SpamThreshold` int NOT NULL,
                        `LinkRiskThreshold` int NOT NULL,
                        `UpdatedAtUtc` datetime(6) NOT NULL,
                        PRIMARY KEY (`CommunityId`),
                        CONSTRAINT `FK_CommunityModerationSettings_Communities_CommunityId` FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE CASCADE
                    );
                    """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS `CommunityShadowMutes` (
                        `CommunityId` char(36) NOT NULL,
                        `ProfileId` char(36) NOT NULL,
                        `CreatedByProfileId` char(36) NOT NULL,
                        `Reason` varchar(300) NULL,
                        `CreatedAtUtc` datetime(6) NOT NULL,
                        `ExpiresAtUtc` datetime(6) NULL,
                        PRIMARY KEY (`CommunityId`, `ProfileId`),
                        KEY `IX_CommunityShadowMutes_ProfileId` (`ProfileId`),
                        KEY `IX_CommunityShadowMutes_CommunityId_ExpiresAtUtc` (`CommunityId`, `ExpiresAtUtc`),
                        CONSTRAINT `FK_CommunityShadowMutes_Communities_CommunityId` FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE CASCADE,
                        CONSTRAINT `FK_CommunityShadowMutes_UserProfiles_ProfileId` FOREIGN KEY (`ProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE CASCADE,
                        CONSTRAINT `FK_CommunityShadowMutes_UserProfiles_CreatedByProfileId` FOREIGN KEY (`CreatedByProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE RESTRICT
                    );
                    """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS `CommunityBanAppeals` (
                        `Id` char(36) NOT NULL,
                        `CommunityId` char(36) NOT NULL,
                        `ProfileId` char(36) NOT NULL,
                        `Reason` varchar(1000) NOT NULL,
                        `Status` varchar(24) NOT NULL,
                        `ResolutionNote` varchar(1000) NULL,
                        `ReviewedByProfileId` char(36) NULL,
                        `CreatedAtUtc` datetime(6) NOT NULL,
                        `ReviewedAtUtc` datetime(6) NULL,
                        PRIMARY KEY (`Id`),
                        KEY `IX_CommunityBanAppeals_CommunityId_Status_CreatedAtUtc` (`CommunityId`, `Status`, `CreatedAtUtc`),
                        KEY `IX_CommunityBanAppeals_ProfileId_CreatedAtUtc` (`ProfileId`, `CreatedAtUtc`),
                        CONSTRAINT `FK_CommunityBanAppeals_Communities_CommunityId` FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE CASCADE,
                        CONSTRAINT `FK_CommunityBanAppeals_UserProfiles_ProfileId` FOREIGN KEY (`ProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE CASCADE,
                        CONSTRAINT `FK_CommunityBanAppeals_UserProfiles_ReviewedByProfileId` FOREIGN KEY (`ReviewedByProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE SET NULL
                    );
                    """, cancellationToken);
            }

            safetySchemaInitialized = true;
        }
        catch (SqliteException)
        {
            // Keep startup resilient for legacy SQLite files. API methods will still function for existing data paths.
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }
}
