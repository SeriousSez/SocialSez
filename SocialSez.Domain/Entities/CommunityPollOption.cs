namespace SocialSez.Domain.Entities;

public class CommunityPollOption
{
    public Guid Id { get; set; }
    public Guid PollId { get; set; }
    public string Text { get; set; } = string.Empty;

    public CommunityPoll Poll { get; set; } = null!;
    public ICollection<CommunityPollVote> Votes { get; set; } = new List<CommunityPollVote>();
}
