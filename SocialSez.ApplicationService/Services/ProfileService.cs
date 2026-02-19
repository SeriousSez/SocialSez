using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class ProfileService(SocialSezContext dbContext) : IProfileService
{
    public async Task<ProfileDto> CreateAsync(CreateProfileRequest request, CancellationToken cancellationToken = default)
    {
        var handle = request.Handle.Trim().ToLowerInvariant();

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
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.UserProfiles.Add(profile);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ToDto(profile);
    }

    public async Task<ProfileDto?> GetByHandleAsync(string handle, CancellationToken cancellationToken = default)
    {
        var normalized = handle.Trim().ToLowerInvariant();
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Handle == normalized, cancellationToken);
        return profile is null ? null : ToDto(profile);
    }

    public async Task<ProfileDto?> GetByIdAsync(Guid profileId, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);
        return profile is null ? null : ToDto(profile);
    }

    public async Task<IReadOnlyCollection<ProfileDto>> SearchAsync(string query, int take = 20, CancellationToken cancellationToken = default)
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

        return profiles.Select(ToDto).ToArray();
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

        return ToDto(profile);
    }

    private static ProfileDto ToDto(UserProfile profile) =>
        new(profile.Id, profile.Handle, profile.DisplayName, profile.Bio, profile.ImageUrl, profile.CreatedAtUtc);
}
