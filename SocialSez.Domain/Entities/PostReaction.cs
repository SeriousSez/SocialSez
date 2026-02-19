namespace SocialSez.Domain.Entities;

public class PostReaction
{
    public Guid PostId { get; set; }
    public Guid ProfileId { get; set; }
    public string Type { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public Post Post { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}
