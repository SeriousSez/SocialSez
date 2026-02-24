namespace SocialSez.Domain.Entities;

public class ReelCommentLike
{
    public Guid ReelCommentId { get; set; }
    public Guid ProfileId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ReelComment ReelComment { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}
