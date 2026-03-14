namespace SocialSez.Domain.Entities;

public class StoryCollection
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Profile { get; set; } = null!;
    public ICollection<StoryCollectionItem> Items { get; set; } = new List<StoryCollectionItem>();
}
