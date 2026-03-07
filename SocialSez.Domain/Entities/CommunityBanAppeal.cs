namespace SocialSez.Domain.Entities;

public class CommunityBanAppeal
{
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public Guid ProfileId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string Status { get; set; } = "Open";
    public string? ResolutionNote { get; set; }
    public Guid? ReviewedByProfileId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? ReviewedAtUtc { get; set; }

    public Community Community { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
    public UserProfile? ReviewedByProfile { get; set; }
}
