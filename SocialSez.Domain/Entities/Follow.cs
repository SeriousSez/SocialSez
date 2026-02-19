namespace SocialSez.Domain.Entities;

public class Follow
{
    public Guid FollowerId { get; set; }
    public Guid FollowedId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Follower { get; set; } = null!;
    public UserProfile Followed { get; set; } = null!;
}
