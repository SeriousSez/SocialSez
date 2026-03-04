namespace SocialSez.Domain.Entities;

public class CommunityPoll
{
    public Guid Id { get; set; }
    public Guid PostId { get; set; }
    public string Question { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public CommunityPost Post { get; set; } = null!;
    public ICollection<CommunityPollOption> Options { get; set; } = new List<CommunityPollOption>();
}
