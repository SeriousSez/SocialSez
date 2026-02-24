namespace SocialSez.Domain.Entities;

public class ReelComment
{
    public Guid Id { get; set; }
    public Guid ReelId { get; set; }
    public Guid AuthorId { get; set; }
    public Guid? ParentCommentId { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public Reel Reel { get; set; } = null!;
    public UserProfile Author { get; set; } = null!;
    public ReelComment? ParentComment { get; set; }
    public ICollection<ReelComment> Replies { get; set; } = new List<ReelComment>();
    public ICollection<ReelCommentLike> Likes { get; set; } = new List<ReelCommentLike>();
}