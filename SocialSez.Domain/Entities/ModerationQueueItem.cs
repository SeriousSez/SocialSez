namespace SocialSez.Domain.Entities;

public class ModerationQueueItem
{
    public Guid Id { get; set; }
    public Guid? CommunityId { get; set; }
    public Guid? ReporterId { get; set; }
    public Guid? TargetProfileId { get; set; }
    public Guid? SourceEntityId { get; set; }
    public string SourceType { get; set; } = "Unknown";
    public string TriggerType { get; set; } = "Unknown";
    public int SpamScore { get; set; }
    public int LinkRiskScore { get; set; }
    public int RiskScore { get; set; }
    public string? LinkUrl { get; set; }
    public string? MatchedKeyword { get; set; }
    public string? ContentSnippet { get; set; }
    public string Status { get; set; } = "Open";
    public string? Resolution { get; set; }
    public string? ResolutionNote { get; set; }
    public Guid? ReviewedByProfileId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? ReviewedAtUtc { get; set; }

    public Community? Community { get; set; }
    public UserProfile? Reporter { get; set; }
    public UserProfile? TargetProfile { get; set; }
    public UserProfile? ReviewedByProfile { get; set; }
}
