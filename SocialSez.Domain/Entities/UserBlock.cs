namespace SocialSez.Domain.Entities;

public class UserBlock
{
    public Guid BlockerId { get; set; }
    public Guid BlockedId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Blocker { get; set; } = null!;
    public UserProfile Blocked { get; set; } = null!;
}
