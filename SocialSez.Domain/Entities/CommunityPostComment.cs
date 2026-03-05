namespace SocialSez.Domain.Entities;

public class CommunityPostComment
{
    public Guid Id { get; set; }
    public Guid PostId { get; set; }
    public Guid? ParentCommentId { get; set; }
    public Guid AuthorId { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public CommunityPost Post { get; set; } = null!;
    public CommunityPostComment? ParentComment { get; set; }
    public UserProfile Author { get; set; } = null!;
}
