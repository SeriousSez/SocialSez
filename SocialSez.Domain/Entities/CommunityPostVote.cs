namespace SocialSez.Domain.Entities;

public class CommunityPostVote
{
    public Guid PostId { get; set; }
    public Guid ProfileId { get; set; }
    public string Type { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public CommunityPost Post { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}
