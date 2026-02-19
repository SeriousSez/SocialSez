namespace SocialSez.Domain.Entities;

public class AppUser
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public Guid ProfileId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Profile { get; set; } = null!;
    public ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();
}
