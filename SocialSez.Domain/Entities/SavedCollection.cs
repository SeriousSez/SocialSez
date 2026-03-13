namespace SocialSez.Domain.Entities;

public class SavedCollection
{
    public Guid Id { get; set; }
    public Guid ProfileId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Profile { get; set; } = null!;
    public ICollection<SavedCollectionItem> Items { get; set; } = new List<SavedCollectionItem>();
}
