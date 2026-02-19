namespace SocialSez.ApplicationService.Models;

public sealed record CreateProfileRequest(string Handle, string DisplayName, string? Bio);

public sealed record UpdateProfileRequest(string DisplayName, string? Bio, string? ImageUrl);

public sealed record ProfileDto(Guid Id, string Handle, string DisplayName, string Bio, string? ImageUrl, DateTime CreatedAtUtc);
