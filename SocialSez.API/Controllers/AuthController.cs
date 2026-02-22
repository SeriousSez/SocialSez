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
        Console.WriteLine("test");
        try
        {
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
}
