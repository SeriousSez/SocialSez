namespace SocialSez.Domain.Entities;

public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid AppUserId { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAtUtc { get; set; }

    public AppUser User { get; set; } = null!;
}
