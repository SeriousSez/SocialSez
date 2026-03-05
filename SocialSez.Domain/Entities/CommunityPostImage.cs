namespace SocialSez.Domain.Entities;

public class CommunityPostImage
{
    public Guid Id { get; set; }
    public Guid PostId { get; set; }
    public string Url { get; set; } = string.Empty;
    public int SortOrder { get; set; }

    public CommunityPost Post { get; set; } = null!;
}
