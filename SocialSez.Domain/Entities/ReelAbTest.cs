namespace SocialSez.Domain.Entities;

public class ReelAbTest
{
    public Guid ReelId { get; set; }
    public Guid OwnerId { get; set; }
    public string VariantATitle { get; set; } = string.Empty;
    public string? VariantAThumbnailUrl { get; set; }
    public string VariantBTitle { get; set; } = string.Empty;
    public string? VariantBThumbnailUrl { get; set; }
    public bool IsActive { get; set; } = true;
    public string? WinningVariantKey { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public int VariantAImpressions { get; set; }
    public int VariantBImpressions { get; set; }
    public int VariantAViews { get; set; }
    public int VariantBViews { get; set; }
    public double VariantAWatchSeconds { get; set; }
    public double VariantBWatchSeconds { get; set; }

    public Reel Reel { get; set; } = null!;
    public UserProfile Owner { get; set; } = null!;
}