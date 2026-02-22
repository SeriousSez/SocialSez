namespace SocialSez.Domain.Entities;

public class Reel
{
    public Guid Id { get; set; }
    public Guid AuthorId { get; set; }
    public string? Caption { get; set; }
    public string VideoUrl { get; set; } = string.Empty;
    public string? ThumbnailUrl { get; set; }
    public int DurationSeconds { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Author { get; set; } = null!;
    public ICollection<ReelLike> Likes { get; set; } = new List<ReelLike>();
}
