namespace SocialSez.Domain.Entities;

public class Blog
{
    public Guid Id { get; set; }
    public Guid OwnerProfileId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? ThemeConfigJson { get; set; }
    public bool IsPublic { get; set; } = true;
    public bool AllowLikes { get; set; } = true;
    public bool AllowComments { get; set; } = true;
    public bool AllowShares { get; set; } = true;
    public bool AllowEmbeds { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile OwnerProfile { get; set; } = null!;
    public ICollection<BlogPost> Posts { get; set; } = new List<BlogPost>();
}
