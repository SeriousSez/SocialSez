namespace SocialSez.Domain.Entities;

public class UserProfile
{
    public Guid Id { get; set; }
    public string Handle { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;
    public string? ImageUrl { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ICollection<Post> Posts { get; set; } = new List<Post>();
    public ICollection<PostReaction> Reactions { get; set; } = new List<PostReaction>();
    public ICollection<CommentReaction> CommentReactions { get; set; } = new List<CommentReaction>();
    public ICollection<Follow> Followers { get; set; } = new List<Follow>();
    public ICollection<Follow> Following { get; set; } = new List<Follow>();
}
