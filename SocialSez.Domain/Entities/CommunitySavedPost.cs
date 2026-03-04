namespace SocialSez.Domain.Entities;

public class CommunitySavedPost
{
    public Guid PostId { get; set; }
    public Guid ProfileId { get; set; }
    public DateTime SavedAtUtc { get; set; } = DateTime.UtcNow;

    public CommunityPost Post { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}