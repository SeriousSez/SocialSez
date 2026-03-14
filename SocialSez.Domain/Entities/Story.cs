namespace SocialSez.Domain.Entities;

public class Story
{
    public Guid Id { get; set; }
    public Guid AuthorId { get; set; }
    public string? Caption { get; set; }
    public string MediaUrl { get; set; } = string.Empty;
    public string? ThumbnailUrl { get; set; }
    public bool IsSensitive { get; set; }
    public bool IsDraft { get; set; }
    public DateTime? ScheduledPublishAtUtc { get; set; }
    public DateTime? PublishedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAtUtc { get; set; }

    public UserProfile Author { get; set; } = null!;
    public ICollection<StoryView> Views { get; set; } = new List<StoryView>();
    public ICollection<StoryCollectionItem> CollectionItems { get; set; } = new List<StoryCollectionItem>();
}
