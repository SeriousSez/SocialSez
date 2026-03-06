namespace SocialSez.Domain.Entities;

public class Community
{
    public Guid Id { get; set; }
    public Guid CreatedByProfileId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? RulesJson { get; set; }
    public string? ImageUrl { get; set; }
    public bool IsPrivate { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile CreatedByProfile { get; set; } = null!;
    public ICollection<CommunityMember> Members { get; set; } = new List<CommunityMember>();
    public ICollection<CommunityPost> Posts { get; set; } = new List<CommunityPost>();
}