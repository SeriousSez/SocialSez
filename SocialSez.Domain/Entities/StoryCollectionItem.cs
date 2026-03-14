namespace SocialSez.Domain.Entities;

public class StoryCollectionItem
{
    public Guid CollectionId { get; set; }
    public Guid StoryId { get; set; }
    public DateTime AddedAtUtc { get; set; } = DateTime.UtcNow;

    public StoryCollection Collection { get; set; } = null!;
    public Story Story { get; set; } = null!;
}
