using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(IAuthService authService) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken)
    {
        try
        {
            Console.WriteLine($"Registering user: {request.DisplayName}");
            var response = await authService.RegisterAsync(request, cancellationToken);
            return Ok(response);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var response = await authService.LoginAsync(request, cancellationToken);
        return response is null ? Unauthorized(new { message = "Invalid credentials." }) : Ok(response);
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh([FromBody] RefreshTokenRequest request, CancellationToken cancellationToken)
    {
        var response = await authService.RefreshAsync(request, cancellationToken);
        return response is null ? Unauthorized(new { message = "Invalid refresh token." }) : Ok(response);
    }

    [HttpPost("revoke")]
    public async Task<ActionResult> Revoke([FromBody] RefreshTokenRequest request, CancellationToken cancellationToken)
    {
        var success = await authService.RevokeRefreshTokenAsync(request, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPost("sessions")]
    public async Task<ActionResult<IReadOnlyCollection<AuthSessionDto>>> GetSessions([FromBody] RefreshTokenRequest? request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var sessions = await authService.GetSessionsAsync(profileId, request?.RefreshToken, cancellationToken);
        return Ok(sessions);
    }

    [Authorize]
    [HttpPost("sessions/revoke")]
    public async Task<ActionResult> RevokeSessionById([FromBody] RevokeSessionByIdRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await authService.RevokeSessionByIdAsync(profileId, request.SessionId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPost("sessions/revoke-others")]
    public async Task<ActionResult<object>> RevokeOtherSessions([FromBody] RefreshTokenRequest? request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var revokedCount = await authService.RevokeOtherSessionsAsync(profileId, request?.RefreshToken, cancellationToken);
        return Ok(new { revokedCount });
    }

    [Authorize]
    [HttpPost("account/deactivate")]
    public async Task<ActionResult> DeactivateAccount(CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await authService.DeactivateAccountAsync(profileId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpDelete("account")]
    public async Task<ActionResult> DeleteAccount(CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await authService.DeleteAccountAsync(profileId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}
