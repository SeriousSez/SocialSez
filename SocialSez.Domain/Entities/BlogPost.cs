namespace SocialSez.Domain.Entities;

public class BlogPost
{
    public Guid Id { get; set; }
    public Guid BlogId { get; set; }
    public Guid AuthorProfileId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Excerpt { get; set; }
    public string? CoverImageUrl { get; set; }
    public string? TagsJson { get; set; }
    public bool IsPublished { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? PublishedAtUtc { get; set; }

    public Blog Blog { get; set; } = null!;
    public UserProfile AuthorProfile { get; set; } = null!;
}
