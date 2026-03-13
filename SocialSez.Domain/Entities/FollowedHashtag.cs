namespace SocialSez.Domain.Entities;

public class FollowedHashtag
{
    public Guid ProfileId { get; set; }
    public string Tag { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Profile { get; set; } = null!;
}