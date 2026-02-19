namespace SocialSez.ApplicationService.Models;

public sealed record RegisterRequest(string Email, string Password, string Handle, string DisplayName, string? Bio);

public sealed record LoginRequest(string Email, string Password);

public sealed record RefreshTokenRequest(string RefreshToken);

public sealed record AuthResponse(
    string Token,
    DateTime ExpiresAtUtc,
    string RefreshToken,
    DateTime RefreshTokenExpiresAtUtc,
    ProfileDto Profile);
