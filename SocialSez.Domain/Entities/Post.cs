namespace SocialSez.Domain.Entities;

public class Post
{
    public Guid Id { get; set; }
    public Guid AuthorId { get; set; }
    public string Content { get; set; } = string.Empty;
    public string? ImageUrl { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Author { get; set; } = null!;
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
    public ICollection<PostReaction> Reactions { get; set; } = new List<PostReaction>();
}
