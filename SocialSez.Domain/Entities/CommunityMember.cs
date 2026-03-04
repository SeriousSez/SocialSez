namespace SocialSez.Domain.Entities;

public class CommunityMember
{
    public Guid CommunityId { get; set; }
    public Guid ProfileId { get; set; }
    public string Role { get; set; } = "Member";
    public DateTime JoinedAtUtc { get; set; } = DateTime.UtcNow;

    public Community Community { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}