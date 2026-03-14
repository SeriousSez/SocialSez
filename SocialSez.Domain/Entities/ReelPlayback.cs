namespace SocialSez.Domain.Entities;

public class ReelPlayback
{
    public Guid ReelId { get; set; }
    public Guid ViewerId { get; set; }
    public double LastPositionSeconds { get; set; }
    public double TotalWatchedSeconds { get; set; }
    public bool IsCompleted { get; set; }
    public DateTime FirstViewedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime LastViewedAtUtc { get; set; } = DateTime.UtcNow;
    public string? VariantKey { get; set; }

    public Reel Reel { get; set; } = null!;
    public UserProfile Viewer { get; set; } = null!;
}