using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse?> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<bool> RevokeRefreshTokenAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
}
