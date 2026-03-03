namespace SocialSez.Domain.Entities;

public class UserMute
{
    public Guid MuterId { get; set; }
    public Guid MutedId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Muter { get; set; } = null!;
    public UserProfile Muted { get; set; } = null!;
}
