namespace SocialSez.Domain.Entities;

public class BlogPostSave
{
    public Guid PostId { get; set; }
    public Guid ProfileId { get; set; }
    public DateTime SavedAtUtc { get; set; } = DateTime.UtcNow;

    public BlogPost Post { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}
