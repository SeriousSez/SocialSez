namespace SocialSez.Domain.Entities;

public class Comment
{
    public Guid Id { get; set; }
    public Guid PostId { get; set; }
    public Guid AuthorId { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public Post Post { get; set; } = null!;
    public UserProfile Author { get; set; } = null!;
    public ICollection<CommentReaction> Reactions { get; set; } = new List<CommentReaction>();
}
