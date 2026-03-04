namespace SocialSez.Domain.Entities;

public class CommunityPost
{
    public Guid Id { get; set; }
    public Guid CommunityId { get; set; }
    public Guid AuthorId { get; set; }
    public string? Content { get; set; }
    public string? ImageUrl { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public Community Community { get; set; } = null!;
    public UserProfile Author { get; set; } = null!;
    public CommunityPoll? Poll { get; set; }
    public ICollection<CommunitySavedPost> SavedBy { get; set; } = new List<CommunitySavedPost>();
}
