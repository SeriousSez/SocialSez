namespace SocialSez.Domain.Entities;

public class ProfileFollowRequest
{
    public Guid FollowerId { get; set; }
    public Guid FollowedId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? RespondedAtUtc { get; set; }
    public string Status { get; set; } = "Pending";

    public UserProfile Follower { get; set; } = null!;
    public UserProfile Followed { get; set; } = null!;
}
