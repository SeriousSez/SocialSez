namespace SocialSez.Domain.Entities;

public class StoryView
{
    public Guid StoryId { get; set; }
    public Guid ViewerId { get; set; }
    public DateTime ViewedAtUtc { get; set; } = DateTime.UtcNow;

    public Story Story { get; set; } = null!;
    public UserProfile Viewer { get; set; } = null!;
}
