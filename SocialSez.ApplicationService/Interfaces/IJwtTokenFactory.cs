using SocialSez.Domain.Entities;

namespace SocialSez.ApplicationService.Interfaces;

public interface IJwtTokenFactory
{
    (string Token, DateTime ExpiresAtUtc) CreateToken(AppUser user, UserProfile profile);
}
