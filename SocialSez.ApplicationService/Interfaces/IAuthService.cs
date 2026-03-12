using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse?> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<bool> RevokeRefreshTokenAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<AuthSessionDto>> GetSessionsAsync(Guid profileId, string? currentRefreshToken, CancellationToken cancellationToken = default);
    Task<bool> RevokeSessionByIdAsync(Guid profileId, Guid sessionId, CancellationToken cancellationToken = default);
    Task<int> RevokeOtherSessionsAsync(Guid profileId, string? currentRefreshToken, CancellationToken cancellationToken = default);
    Task<bool> DeactivateAccountAsync(Guid profileId, CancellationToken cancellationToken = default);
    Task<bool> DeleteAccountAsync(Guid profileId, CancellationToken cancellationToken = default);
}
