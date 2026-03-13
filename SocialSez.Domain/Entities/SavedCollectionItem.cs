namespace SocialSez.Domain.Entities;

public class SavedCollectionItem
{
    public Guid CollectionId { get; set; }
    public Guid SavedItemId { get; set; }
    public DateTime AddedAtUtc { get; set; } = DateTime.UtcNow;

    public SavedCollection Collection { get; set; } = null!;
    public SavedItem SavedItem { get; set; } = null!;
}
