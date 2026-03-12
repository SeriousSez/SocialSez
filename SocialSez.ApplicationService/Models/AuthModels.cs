namespace SocialSez.ApplicationService.Models;

public sealed record RegisterRequest(string Email, string Password, string Handle, string DisplayName, string? Bio);

public sealed record LoginRequest(string Email, string Password);

public sealed record RefreshTokenRequest(string RefreshToken);

public sealed record RevokeSessionByIdRequest(Guid SessionId);

public sealed record AuthSessionDto(
    Guid Id,
    DateTime CreatedAtUtc,
    DateTime ExpiresAtUtc,
    bool IsRevoked,
    bool IsCurrent);

public sealed record AuthResponse(
    string Token,
    DateTime ExpiresAtUtc,
    string RefreshToken,
    DateTime RefreshTokenExpiresAtUtc,
    ProfileDto Profile);
