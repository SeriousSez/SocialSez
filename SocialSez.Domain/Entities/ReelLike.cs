namespace SocialSez.Domain.Entities;

public class ReelLike
{
    public Guid ReelId { get; set; }
    public Guid ProfileId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public Reel Reel { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}
