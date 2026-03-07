namespace SocialSez.Domain.Entities;

public class CommunityShadowMute
{
    public Guid CommunityId { get; set; }
    public Guid ProfileId { get; set; }
    public Guid CreatedByProfileId { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAtUtc { get; set; }

    public Community Community { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
    public UserProfile CreatedByProfile { get; set; } = null!;
}
