namespace SocialSez.Domain.Entities;

public class CommentReaction
{
    public Guid CommentId { get; set; }
    public Guid ProfileId { get; set; }
    public string Type { get; set; } = "Like";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public Comment Comment { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}