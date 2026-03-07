namespace SocialSez.Domain.Entities;

public class CommunityModerationSetting
{
    public Guid CommunityId { get; set; }
    public string RulePreset { get; set; } = "Balanced";
    public string? KeywordFiltersJson { get; set; }
    public bool AutoModerationEnabled { get; set; } = true;
    public int SpamThreshold { get; set; } = 65;
    public int LinkRiskThreshold { get; set; } = 60;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public Community Community { get; set; } = null!;
}
