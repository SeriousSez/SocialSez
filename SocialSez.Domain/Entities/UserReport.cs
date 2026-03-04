namespace SocialSez.Domain.Entities;

public class UserReport
{
    public Guid Id { get; set; }
    public Guid ReporterId { get; set; }
    public Guid TargetProfileId { get; set; }
    public Guid? TargetPostId { get; set; }
    public Guid? TargetReelId { get; set; }
    public Guid? TargetStoryId { get; set; }
    public Guid? TargetCommentId { get; set; }
    public Guid? TargetReelCommentId { get; set; }
    public Guid? TargetMessageId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string? Details { get; set; }
    public string Status { get; set; } = "Open";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Reporter { get; set; } = null!;
    public UserProfile TargetProfile { get; set; } = null!;
    public Post? TargetPost { get; set; }
    public Reel? TargetReel { get; set; }
    public Story? TargetStory { get; set; }
    public Comment? TargetComment { get; set; }
    public ReelComment? TargetReelComment { get; set; }
    public ChatMessage? TargetMessage { get; set; }
}
