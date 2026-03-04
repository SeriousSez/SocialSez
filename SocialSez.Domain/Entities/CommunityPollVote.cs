namespace SocialSez.Domain.Entities;

public class CommunityPollVote
{
    public Guid OptionId { get; set; }
    public Guid VoterId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public CommunityPollOption Option { get; set; } = null!;
    public UserProfile Voter { get; set; } = null!;
}
