using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Text.RegularExpressions;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class ProfileService(SocialSezContext dbContext, IMemoryCache memoryCache) : IProfileService
{
    private static readonly TimeSpan HandleChangeCooldown = TimeSpan.FromDays(30);
    private static readonly TimeSpan SearchCacheTtl = TimeSpan.FromSeconds(30);

    public async Task<ProfileDto> CreateAsync(CreateProfileRequest request, CancellationToken cancellationToken = default)
    {
        var handle = NormalizeHandle(request.Handle);

        if (string.IsNullOrWhiteSpace(handle))
        {
            throw new ArgumentException("Handle is required.", nameof(request));
        }

        if (await dbContext.UserProfiles.AnyAsync(x => x.Handle == handle, cancellationToken))
        {
            throw new InvalidOperationException("Handle already exists.");
        }

        var profile = new UserProfile
        {
            Id = Guid.NewGuid(),
            Handle = handle,
            DisplayName = request.DisplayName.Trim(),
            Bio = request.Bio?.Trim() ?? string.Empty,
            ImageUrl = null,
            IsPrivate = false,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.UserProfiles.Add(profile);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpProfile();

        return ToDto(profile, true);
    }

    public async Task<ProfileDto?> GetByHandleAsync(string handle, Guid? viewerId = null, CancellationToken cancellationToken = default)
    {
        var normalized = handle.Trim().ToLowerInvariant();
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Handle == normalized, cancellationToken);
        if (profile is null)
        {
            return null;
        }

        var canViewPrivateInfo = await CanViewPrivateInfoAsync(viewerId, profile.Id, cancellationToken);
        return ToDto(profile, canViewPrivateInfo);
    }

    public async Task<ProfileDto?> GetByIdAsync(Guid profileId, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);
        return profile is null ? null : ToDto(profile, true);
    }

    public async Task<ProfileActivitySummaryDto?> GetActivitySummaryByHandleAsync(string handle, CancellationToken cancellationToken = default)
    {
        var normalized = handle.Trim().ToLowerInvariant();
        var profile = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Handle == normalized, cancellationToken);

        if (profile is null)
        {
            return null;
        }

        var postCount = await dbContext.Posts
            .AsNoTracking()
            .CountAsync(x => x.AuthorId == profile.Id, cancellationToken);

        var followerIdsFromFollows = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowedId == profile.Id)
            .Select(x => x.FollowerId)
            .ToListAsync(cancellationToken);

        var followerIdsFromApprovedRequests = await dbContext.ProfileFollowRequests
            .AsNoTracking()
            .Where(x => x.FollowedId == profile.Id && x.Status == "Approved")
            .Select(x => x.FollowerId)
            .ToListAsync(cancellationToken);

        var followingIdsFromFollows = await dbContext.Follows
            .AsNoTracking()
            .Where(x => x.FollowerId == profile.Id)
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        var followingIdsFromApprovedRequests = await dbContext.ProfileFollowRequests
            .AsNoTracking()
            .Where(x => x.FollowerId == profile.Id && x.Status == "Approved")
            .Select(x => x.FollowedId)
            .ToListAsync(cancellationToken);

        var followerCount = followerIdsFromFollows
            .Concat(followerIdsFromApprovedRequests)
            .Distinct()
            .Count();

        var followingCount = followingIdsFromFollows
            .Concat(followingIdsFromApprovedRequests)
            .Distinct()
            .Count();

        return new ProfileActivitySummaryDto(
            postCount,
            followerCount,
            followingCount);
    }

    public async Task<EngagementStreakDto?> GetEngagementStreakAsync(Guid profileId, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.UserProfiles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);

        if (profile is null)
        {
            return null;
        }

        var lastActiveDate = profile.EngagementStreakLastActiveDateUtc.HasValue
            ? DateOnly.FromDateTime(profile.EngagementStreakLastActiveDateUtc.Value)
            : (DateOnly?)null;

        return new EngagementStreakDto(
            Math.Max(0, profile.EngagementStreakCurrentDays),
            Math.Max(0, profile.EngagementStreakBestDays),
            lastActiveDate);
    }

    public async Task<EngagementStreakDto?> TrackEngagementAsync(Guid profileId, TrackEngagementStreakRequest request, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);
        if (profile is null)
        {
            return null;
        }

        var activityDate = request.LocalDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var lastActiveDate = profile.EngagementStreakLastActiveDateUtc.HasValue
            ? DateOnly.FromDateTime(profile.EngagementStreakLastActiveDateUtc.Value)
            : (DateOnly?)null;

        if (lastActiveDate == activityDate)
        {
            return new EngagementStreakDto(
                Math.Max(0, profile.EngagementStreakCurrentDays),
                Math.Max(0, profile.EngagementStreakBestDays),
                activityDate);
        }

        if (lastActiveDate == activityDate.AddDays(-1))
        {
            profile.EngagementStreakCurrentDays = Math.Max(1, profile.EngagementStreakCurrentDays) + 1;
        }
        else
        {
            profile.EngagementStreakCurrentDays = 1;
        }

        profile.EngagementStreakBestDays = Math.Max(profile.EngagementStreakBestDays, profile.EngagementStreakCurrentDays);
        profile.EngagementStreakLastActiveDateUtc = activityDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        await dbContext.SaveChangesAsync(cancellationToken);

        return new EngagementStreakDto(
            Math.Max(0, profile.EngagementStreakCurrentDays),
            Math.Max(0, profile.EngagementStreakBestDays),
            activityDate);
    }

    public async Task<IReadOnlyCollection<ProfileDto>> SearchAsync(string query, Guid? viewerId = null, int take = 20, CancellationToken cancellationToken = default)
    {
        var normalizedQuery = DiscoverySearchBackend.NormalizeQuery(query);
        var expandedTerms = DiscoverySearchBackend.ExpandTerms(normalizedQuery);
        if (expandedTerms.Count == 0)
        {
            return Array.Empty<ProfileDto>();
        }

        take = Math.Clamp(take, 1, 100);
        var candidateTake = Math.Clamp(take * 4, take, 320);
        var cacheKey = $"profile:search:v3:rv={SearchCacheVersionStamp.ProfileVersion}:viewer={viewerId?.ToString() ?? "anon"}:q={normalizedQuery ?? string.Empty}:take={take}";
        return await SearchResultCache.GetOrCreateAsync(memoryCache, cacheKey, SearchCacheTtl, async () =>
        {
            HashSet<Guid>? blockedProfileIds = null;
            if (viewerId.HasValue)
            {
                blockedProfileIds = await GetBlockedProfileIdsAsync(viewerId.Value, cancellationToken);
            }

            var profilesQuery = dbContext.UserProfiles
                .AsNoTracking();

            if (viewerId.HasValue && blockedProfileIds is not null && blockedProfileIds.Count > 0)
            {
                profilesQuery = profilesQuery.Where(x => !blockedProfileIds.Contains(x.Id));
            }

            if (!viewerId.HasValue)
            {
                profilesQuery = profilesQuery.Where(x => !x.IsPrivate);
            }

            var candidates = await profilesQuery
                .OrderBy(x => x.Handle)
                .Take(candidateTake)
                .ToArrayAsync(cancellationToken);

            HashSet<Guid>? followedIds = null;
            if (viewerId.HasValue)
            {
                var followedList = await dbContext.Follows
                    .AsNoTracking()
                    .Where(x => x.FollowerId == viewerId.Value)
                    .Select(x => x.FollowedId)
                    .ToListAsync(cancellationToken);

                followedIds = followedList.ToHashSet();
            }

            var profiles = candidates
                .Select(profile => new
                {
                    Profile = profile,
                    Score = DiscoverySearchBackend.ScoreFields(expandedTerms,
                        (profile.Handle, 1.2),
                        (profile.DisplayName, 1.0),
                        (profile.Bio, 0.4))
                })
                .Where(x => x.Score > 0)
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.Profile.Handle)
                .Take(take)
                .Select(x => x.Profile)
                .ToArray();

            return profiles
                .Select(profile =>
                {
                    var canViewPrivateInfo = !profile.IsPrivate
                        || (viewerId.HasValue && (viewerId.Value == profile.Id || (followedIds?.Contains(profile.Id) ?? false)));

                    return ToDto(profile, canViewPrivateInfo);
                })
                .ToArray();
        });
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

    public async Task<ProfileDto?> UpdateAsync(Guid profileId, UpdateProfileRequest request, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);
        if (profile is null)
        {
            return null;
        }

        var requestedHandleRaw = request.Handle?.Trim();
        if (!string.IsNullOrWhiteSpace(requestedHandleRaw))
        {
            var normalizedRequestedHandle = NormalizeHandle(requestedHandleRaw);
            if (string.IsNullOrWhiteSpace(normalizedRequestedHandle))
            {
                throw new ArgumentException("Handle is required.", nameof(request));
            }

            if (!string.Equals(profile.Handle, normalizedRequestedHandle, StringComparison.Ordinal))
            {
                var nowUtc = DateTime.UtcNow;
                if (profile.LastHandleChangeAtUtc is DateTime lastHandleChangeAtUtc)
                {
                    var cooldownEndsAtUtc = lastHandleChangeAtUtc.Add(HandleChangeCooldown);
                    if (cooldownEndsAtUtc > nowUtc)
                    {
                        var remaining = cooldownEndsAtUtc - nowUtc;
                        var remainingDays = Math.Max(1, (int)Math.Ceiling(remaining.TotalDays));
                        throw new InvalidOperationException($"You can change your handle every 30 days. Try again in {remainingDays} day{(remainingDays == 1 ? string.Empty : "s")}.");
                    }
                }

                var isTaken = await dbContext.UserProfiles
                    .AnyAsync(x => x.Id != profileId && x.Handle == normalizedRequestedHandle, cancellationToken);

                if (isTaken)
                {
                    throw new InvalidOperationException("Handle already exists.");
                }

                profile.Handle = normalizedRequestedHandle;
                profile.LastHandleChangeAtUtc = nowUtc;
            }
        }

        profile.DisplayName = request.DisplayName.Trim();
        profile.Bio = request.Bio?.Trim() ?? string.Empty;
        profile.ImageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) ? null : request.ImageUrl.Trim();

        if (request.DateOfBirth.HasValue)
        {
            var dateOfBirth = request.DateOfBirth.Value.Date;
            if (dateOfBirth > DateTime.UtcNow.Date)
            {
                throw new ArgumentException("Date of birth cannot be in the future.", nameof(request));
            }

            if (CalculateAgeInYears(dateOfBirth, DateTime.UtcNow.Date) < 13)
            {
                throw new ArgumentException("You must be at least 13 years old.", nameof(request));
            }

            profile.DateOfBirth = dateOfBirth;
        }

        if (!string.IsNullOrWhiteSpace(request.CountryCode))
        {
            var normalizedCountryCode = NormalizeCountryCode(request.CountryCode);
            if (string.IsNullOrEmpty(normalizedCountryCode))
            {
                throw new ArgumentException("Country code must be a valid 2-letter ISO code.", nameof(request));
            }

            profile.CountryCode = normalizedCountryCode;
        }

        if (request.MarketingOptIn.HasValue)
        {
            profile.MarketingOptIn = request.MarketingOptIn.Value;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpProfile();

        return ToDto(profile, true);
    }

    public async Task<ProfileDto?> UpdatePrivacyAsync(Guid profileId, UpdateProfilePrivacyRequest request, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);
        if (profile is null)
        {
            return null;
        }

        profile.IsPrivate = request.IsPrivate;
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpProfile();
        return ToDto(profile, true);
    }

    private async Task<bool> CanViewPrivateInfoAsync(Guid? viewerId, Guid targetProfileId, CancellationToken cancellationToken)
    {
        if (!viewerId.HasValue || viewerId.Value == targetProfileId)
        {
            return viewerId.HasValue && viewerId.Value == targetProfileId;
        }

        return await dbContext.Follows.AnyAsync(
            x => x.FollowerId == viewerId.Value && x.FollowedId == targetProfileId,
            cancellationToken);
    }

    private static ProfileDto ToDto(UserProfile profile, bool canViewPrivateInfo)
    {
        var handleChangeAvailableAtUtc = CalculateHandleChangeAvailableAtUtc(profile.LastHandleChangeAtUtc);

        if (!profile.IsPrivate || canViewPrivateInfo)
        {
            return new ProfileDto(
                profile.Id,
                profile.Handle,
                profile.DisplayName,
                profile.Bio,
                profile.ImageUrl,
                profile.IsPrivate,
                profile.CreatedAtUtc,
                handleChangeAvailableAtUtc,
                profile.DateOfBirth,
                profile.CountryCode,
                profile.MarketingOptIn);
        }

        return new ProfileDto(
            profile.Id,
            profile.Handle,
            profile.DisplayName,
            string.Empty,
            profile.ImageUrl,
            profile.IsPrivate,
            profile.CreatedAtUtc,
            handleChangeAvailableAtUtc,
            null,
            null,
            false);
    }

    private static DateTime? CalculateHandleChangeAvailableAtUtc(DateTime? lastHandleChangeAtUtc)
    {
        if (!lastHandleChangeAtUtc.HasValue)
        {
            return null;
        }

        var availability = lastHandleChangeAtUtc.Value.Add(HandleChangeCooldown);
        return availability > DateTime.UtcNow ? availability : null;
    }

    private static string NormalizeHandle(string handle)
    {
        var normalized = (handle ?? string.Empty).Trim().ToLowerInvariant();
        return Regex.Replace(normalized, "\\s+", "-");
    }

    private static string? NormalizeCountryCode(string? countryCode)
    {
        if (string.IsNullOrWhiteSpace(countryCode))
        {
            return null;
        }

        var normalized = countryCode.Trim().ToUpperInvariant();
        if (normalized.Length != 2 || !normalized.All(char.IsLetter))
        {
            return string.Empty;
        }

        return normalized;
    }

    private static int CalculateAgeInYears(DateTime dateOfBirth, DateTime currentDate)
    {
        var age = currentDate.Year - dateOfBirth.Year;
        if (dateOfBirth.Date > currentDate.AddYears(-age))
        {
            age--;
        }

        return age;
    }
}

