namespace SocialSez.Domain.Entities;

public class StoryPlaybackProgress
{
    public Guid ViewerId { get; set; }
    public Guid AuthorId { get; set; }
    public Guid StoryId { get; set; }
    public double LastPositionSeconds { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Viewer { get; set; } = null!;
    public UserProfile Author { get; set; } = null!;
    public Story Story { get; set; } = null!;
}