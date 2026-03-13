namespace SocialSez.Domain.Entities;

public class SavedItem
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public string ItemType { get; set; } = string.Empty; // "Post" | "Reel" | "CommunityPost" | "BlogPost"
    public Guid? PostId { get; set; }
    public Guid? ReelId { get; set; }
    public Guid? CommunityPostId { get; set; }
    public Guid? BlogPostId { get; set; }
    public DateTime SavedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Profile { get; set; } = null!;
    public Post? Post { get; set; }
    public Reel? Reel { get; set; }
    public CommunityPost? CommunityPost { get; set; }
    public BlogPost? BlogPost { get; set; }
    public ICollection<SavedCollectionItem> CollectionItems { get; set; } = new List<SavedCollectionItem>();
}
