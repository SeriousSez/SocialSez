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
        var displayName = request.DisplayName?.Trim() ?? string.Empty;
        var countryCode = NormalizeCountryCode(request.CountryCode);

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(request.Password))
        {
            throw new ArgumentException("Email and password are required.");
        }

        if (request.Password.Length < 8)
        {
            throw new ArgumentException("Password must be at least 8 characters.");
        }

        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new ArgumentException("Display name is required.");
        }

        if (request.DateOfBirth is DateTime dateOfBirth)
        {
            if (dateOfBirth.Date > DateTime.UtcNow.Date)
            {
                throw new ArgumentException("Date of birth cannot be in the future.");
            }

            if (CalculateAgeInYears(dateOfBirth.Date, DateTime.UtcNow.Date) < 13)
            {
                throw new ArgumentException("You must be at least 13 years old to register.");
            }
        }

        if (request.CountryCode is not null && string.IsNullOrEmpty(countryCode))
        {
            throw new ArgumentException("Country code must be a valid 2-letter ISO code.");
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
            DisplayName = displayName,
            Bio = request.Bio?.Trim() ?? string.Empty,
            DateOfBirth = request.DateOfBirth?.Date,
            CountryCode = countryCode,
            MarketingOptIn = request.MarketingOptIn,
            IsPrivate = request.IsPrivateByDefault,
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

    public async Task<IReadOnlyCollection<AuthSessionDto>> GetSessionsAsync(Guid profileId, string? currentRefreshToken, CancellationToken cancellationToken = default)
    {
        var user = await dbContext.AppUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.ProfileId == profileId, cancellationToken);

        if (user is null)
        {
            return Array.Empty<AuthSessionDto>();
        }

        var now = DateTime.UtcNow;
        var currentTokenHash = string.IsNullOrWhiteSpace(currentRefreshToken)
            ? null
            : HashToken(currentRefreshToken);

        var sessions = await dbContext.RefreshTokens
            .AsNoTracking()
            .Where(x => x.AppUserId == user.Id)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => new AuthSessionDto(
                x.Id,
                x.CreatedAtUtc,
                x.ExpiresAtUtc,
                x.RevokedAtUtc != null || x.ExpiresAtUtc <= now,
                currentTokenHash != null && x.TokenHash == currentTokenHash))
            .ToListAsync(cancellationToken);

        return sessions;
    }

    public async Task<bool> RevokeSessionByIdAsync(Guid profileId, Guid sessionId, CancellationToken cancellationToken = default)
    {
        var user = await dbContext.AppUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.ProfileId == profileId, cancellationToken);

        if (user is null)
        {
            return false;
        }

        var refreshToken = await dbContext.RefreshTokens
            .FirstOrDefaultAsync(x => x.Id == sessionId && x.AppUserId == user.Id, cancellationToken);

        if (refreshToken is null || refreshToken.RevokedAtUtc is not null)
        {
            return false;
        }

        refreshToken.RevokedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<int> RevokeOtherSessionsAsync(Guid profileId, string? currentRefreshToken, CancellationToken cancellationToken = default)
    {
        var user = await dbContext.AppUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.ProfileId == profileId, cancellationToken);

        if (user is null)
        {
            return 0;
        }

        var now = DateTime.UtcNow;
        var currentTokenHash = string.IsNullOrWhiteSpace(currentRefreshToken)
            ? null
            : HashToken(currentRefreshToken);

        var candidates = await dbContext.RefreshTokens
            .Where(x => x.AppUserId == user.Id && x.RevokedAtUtc == null && x.ExpiresAtUtc > now)
            .ToListAsync(cancellationToken);

        foreach (var token in candidates)
        {
            if (currentTokenHash is not null && token.TokenHash == currentTokenHash)
            {
                continue;
            }

            token.RevokedAtUtc = now;
        }

        var changed = candidates.Count(x => x.RevokedAtUtc == now);
        if (changed > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return changed;
    }

    public async Task<bool> DeactivateAccountAsync(Guid profileId, CancellationToken cancellationToken = default)
    {
        var user = await dbContext.AppUsers
            .Include(x => x.Profile)
            .FirstOrDefaultAsync(x => x.ProfileId == profileId, cancellationToken);

        if (user is null)
        {
            return false;
        }

        user.Profile.IsPrivate = true;

        var now = DateTime.UtcNow;
        var activeTokens = await dbContext.RefreshTokens
            .Where(x => x.AppUserId == user.Id && x.RevokedAtUtc == null)
            .ToListAsync(cancellationToken);

        foreach (var token in activeTokens)
        {
            token.RevokedAtUtc = now;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> DeleteAccountAsync(Guid profileId, CancellationToken cancellationToken = default)
    {
        var user = await dbContext.AppUsers
            .Include(x => x.Profile)
            .FirstOrDefaultAsync(x => x.ProfileId == profileId, cancellationToken);

        if (user is null)
        {
            return false;
        }

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var replacementSecret = GenerateRefreshToken();
        var now = DateTime.UtcNow;

        user.Email = $"deleted+{suffix}@socialsez.local";
        user.PasswordHash = passwordHasher.HashPassword(user, replacementSecret);

        user.Profile.Handle = $"deleted-{suffix}";
        user.Profile.DisplayName = "Deleted User";
        user.Profile.Bio = string.Empty;
        user.Profile.ImageUrl = null;
        user.Profile.DateOfBirth = null;
        user.Profile.CountryCode = null;
        user.Profile.MarketingOptIn = false;
        user.Profile.IsPrivate = true;

        var tokens = await dbContext.RefreshTokens
            .Where(x => x.AppUserId == user.Id && x.RevokedAtUtc == null)
            .ToListAsync(cancellationToken);

        foreach (var token in tokens)
        {
            token.RevokedAtUtc = now;
        }

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
            new ProfileDto(
                profile.Id,
                profile.Handle,
                profile.DisplayName,
                profile.Bio,
                profile.ImageUrl,
                profile.IsPrivate,
                profile.CreatedAtUtc,
                CalculateHandleChangeAvailableAtUtc(profile.LastHandleChangeAtUtc),
                profile.DateOfBirth,
                profile.CountryCode,
                profile.MarketingOptIn));
    }

    private static DateTime? CalculateHandleChangeAvailableAtUtc(DateTime? lastHandleChangeAtUtc)
    {
        if (!lastHandleChangeAtUtc.HasValue)
        {
            return null;
        }

        var availability = lastHandleChangeAtUtc.Value.AddDays(30);
        return availability > DateTime.UtcNow ? availability : null;
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
