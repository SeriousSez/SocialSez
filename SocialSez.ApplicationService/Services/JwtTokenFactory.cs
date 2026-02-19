using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.Domain.Entities;

namespace SocialSez.ApplicationService.Services;

public class JwtTokenFactory(IConfiguration configuration) : IJwtTokenFactory
{
    public (string Token, DateTime ExpiresAtUtc) CreateToken(AppUser user, UserProfile profile)
    {
        var issuer = configuration["Jwt:Issuer"] ?? "SocialSez";
        var audience = configuration["Jwt:Audience"] ?? "SocialSez.Clients";
        var key = configuration["Jwt:Key"] ?? throw new InvalidOperationException("Missing Jwt:Key configuration.");
        var expiryMinutes = int.TryParse(configuration["Jwt:ExpiryMinutes"], out var parsed) ? parsed : 120;

        var expiresAtUtc = DateTime.UtcNow.AddMinutes(expiryMinutes);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, profile.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, profile.Id.ToString()),
            new Claim("uid", user.Id.ToString()),
            new Claim("handle", profile.Handle),
            new Claim(JwtRegisteredClaimNames.Email, user.Email)
        };

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: expiresAtUtc,
            signingCredentials: credentials);

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAtUtc);
    }
}
