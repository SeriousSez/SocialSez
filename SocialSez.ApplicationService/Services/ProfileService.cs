using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class ProfileService(SocialSezContext dbContext) : IProfileService
{
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

        var sevenDaysAgoUtc = DateTime.UtcNow.AddDays(-7);

        var postCountTask = dbContext.Posts
            .AsNoTracking()
            .CountAsync(x => x.AuthorId == profile.Id, cancellationToken);

        var commentCountOnPostsTask = dbContext.Comments
            .AsNoTracking()
            .CountAsync(x => x.Post.AuthorId == profile.Id, cancellationToken);

        var activeLast7DaysTask = dbContext.Posts
            .AsNoTracking()
            .CountAsync(x => x.AuthorId == profile.Id && x.CreatedAtUtc >= sevenDaysAgoUtc, cancellationToken);

        await Task.WhenAll(postCountTask, commentCountOnPostsTask, activeLast7DaysTask);

        return new ProfileActivitySummaryDto(
            postCountTask.Result,
            commentCountOnPostsTask.Result,
            activeLast7DaysTask.Result);
    }

    public async Task<IReadOnlyCollection<ProfileDto>> SearchAsync(string query, Guid? viewerId = null, int take = 20, CancellationToken cancellationToken = default)
    {
        var normalizedQuery = query.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedQuery))
        {
            return Array.Empty<ProfileDto>();
        }

        take = Math.Clamp(take, 1, 100);

        var profiles = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => x.Handle.Contains(normalizedQuery) || x.DisplayName.ToLower().Contains(normalizedQuery))
            .OrderBy(x => x.Handle)
            .Take(take)
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

        return profiles
            .Select(profile =>
            {
                var canViewPrivateInfo = !profile.IsPrivate
                    || (viewerId.HasValue && (viewerId.Value == profile.Id || (followedIds?.Contains(profile.Id) ?? false)));

                return ToDto(profile, canViewPrivateInfo);
            })
            .ToArray();
    }

    public async Task<ProfileDto?> UpdateAsync(Guid profileId, UpdateProfileRequest request, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);
        if (profile is null)
        {
            return null;
        }

        profile.DisplayName = request.DisplayName.Trim();
        profile.Bio = request.Bio?.Trim() ?? string.Empty;
        profile.ImageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) ? null : request.ImageUrl.Trim();

        await dbContext.SaveChangesAsync(cancellationToken);

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
        if (!profile.IsPrivate || canViewPrivateInfo)
        {
            return new ProfileDto(profile.Id, profile.Handle, profile.DisplayName, profile.Bio, profile.ImageUrl, profile.IsPrivate, profile.CreatedAtUtc);
        }

        return new ProfileDto(profile.Id, profile.Handle, profile.DisplayName, string.Empty, profile.ImageUrl, profile.IsPrivate, profile.CreatedAtUtc);
    }

    private static string NormalizeHandle(string handle)
    {
        var normalized = (handle ?? string.Empty).Trim().ToLowerInvariant();
        return Regex.Replace(normalized, "\\s+", "-");
    }
}
