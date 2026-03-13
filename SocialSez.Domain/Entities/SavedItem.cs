namespace SocialSez.Domain.Entities;

public class SavedItem
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public string ItemType { get; set; } = string.Empty; // "Post" | "Reel"
    public Guid? PostId { get; set; }
    public Guid? ReelId { get; set; }
    public DateTime SavedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Profile { get; set; } = null!;
    public Post? Post { get; set; }
    public Reel? Reel { get; set; }
    public ICollection<SavedCollectionItem> CollectionItems { get; set; } = new List<SavedCollectionItem>();
}
