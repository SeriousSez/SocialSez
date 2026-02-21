using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class AuthService(
    SocialSezContext dbContext,
    IJwtTokenFactory jwtTokenFactory,
    IConfiguration configuration,
    PasswordHasher<AppUser> passwordHasher) : IAuthService
{
    public async Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var handle = NormalizeHandle(request.Handle);

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(request.Password))
        {
            throw new ArgumentException("Email and password are required.");
        }

        if (await dbContext.AppUsers.AnyAsync(x => x.Email == email, cancellationToken))
        {
            throw new InvalidOperationException("Email already exists.");
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
            CreatedAtUtc = DateTime.UtcNow
        };

        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            ProfileId = profile.Id,
            CreatedAtUtc = DateTime.UtcNow
        };

        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        dbContext.UserProfiles.Add(profile);
        dbContext.AppUsers.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);

        return await BuildAuthResponseAsync(user, profile, cancellationToken);
    }

    public async Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        var user = await dbContext.AppUsers
            .Include(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Email == email, cancellationToken);

        if (user is null)
        {
            return null;
        }

        var result = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (result == PasswordVerificationResult.Failed)
        {
            return null;
        }

        return await BuildAuthResponseAsync(user, user.Profile, cancellationToken);
    }

    public async Task<AuthResponse?> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default)
    {
        var tokenHash = HashToken(request.RefreshToken);

        var refreshToken = await dbContext.RefreshTokens
            .Include(x => x.User)
            .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.TokenHash == tokenHash, cancellationToken);

        if (refreshToken is null || refreshToken.RevokedAtUtc is not null || refreshToken.ExpiresAtUtc <= DateTime.UtcNow)
        {
            return null;
        }

        refreshToken.RevokedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return await BuildAuthResponseAsync(refreshToken.User, refreshToken.User.Profile, cancellationToken);
    }

    public async Task<bool> RevokeRefreshTokenAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default)
    {
        var tokenHash = HashToken(request.RefreshToken);

        var refreshToken = await dbContext.RefreshTokens
            .FirstOrDefaultAsync(x => x.TokenHash == tokenHash, cancellationToken);

        if (refreshToken is null || refreshToken.RevokedAtUtc is not null)
        {
            return false;
        }

        refreshToken.RevokedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task<AuthResponse> BuildAuthResponseAsync(AppUser user, UserProfile profile, CancellationToken cancellationToken)
    {
        var (token, expiresAtUtc) = jwtTokenFactory.CreateToken(user, profile);
        var (refreshTokenRaw, refreshTokenExpiresAtUtc) = await CreateRefreshTokenAsync(user.Id, cancellationToken);

        return new AuthResponse(
            token,
            expiresAtUtc,
            refreshTokenRaw,
            refreshTokenExpiresAtUtc,
            new ProfileDto(profile.Id, profile.Handle, profile.DisplayName, profile.Bio, profile.ImageUrl, profile.CreatedAtUtc));
    }

    private async Task<(string RefreshToken, DateTime ExpiresAtUtc)> CreateRefreshTokenAsync(Guid userId, CancellationToken cancellationToken)
    {
        var refreshToken = GenerateRefreshToken();
        var expiresAtUtc = DateTime.UtcNow.AddDays(GetRefreshExpiryDays());

        dbContext.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            AppUserId = userId,
            TokenHash = HashToken(refreshToken),
            ExpiresAtUtc = expiresAtUtc,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        return (refreshToken, expiresAtUtc);
    }

    private int GetRefreshExpiryDays()
    {
        return int.TryParse(configuration["Jwt:RefreshExpiryDays"], out var days) ? Math.Max(days, 1) : 14;
    }

    private static string GenerateRefreshToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
    }

    private static string HashToken(string token)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(hash);
    }

    private static string NormalizeHandle(string handle)
    {
        var normalized = (handle ?? string.Empty).Trim().ToLowerInvariant();
        return Regex.Replace(normalized, "\\s+", "-");
    }
}
