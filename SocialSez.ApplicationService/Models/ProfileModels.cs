namespace SocialSez.ApplicationService.Models;

public sealed record CreateProfileRequest(string Handle, string DisplayName, string? Bio);

public sealed record UpdateProfileRequest(
    string DisplayName,
    string? Bio,
    string? ImageUrl,
    string? Handle,
    DateTime? DateOfBirth = null,
    string? CountryCode = null,
    bool? MarketingOptIn = null);

public sealed record UpdateProfilePrivacyRequest(bool IsPrivate);

public sealed record ProfileDto(
    Guid Id,
    string Handle,
    string DisplayName,
    string Bio,
    string? ImageUrl,
    bool IsPrivate,
    DateTime CreatedAtUtc,
    DateTime? HandleChangeAvailableAtUtc = null,
    DateTime? DateOfBirth = null,
    string? CountryCode = null,
    bool MarketingOptIn = false);

public sealed record ProfileActivitySummaryDto(int PostCount, int FollowerCount, int FollowingCount);
