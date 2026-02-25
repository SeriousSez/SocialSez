namespace SocialSez.Domain.Entities;

public class UserProfile
{
    public Guid Id { get; set; }
    public string Handle { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;
    public string? ImageUrl { get; set; }
    public bool IsPrivate { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? LastHandleChangeAtUtc { get; set; }

    public ICollection<Post> Posts { get; set; } = new List<Post>();
    public ICollection<PostReaction> Reactions { get; set; } = new List<PostReaction>();
    public ICollection<CommentReaction> CommentReactions { get; set; } = new List<CommentReaction>();
    public ICollection<ChatConversation> CreatedConversations { get; set; } = new List<ChatConversation>();
    public ICollection<ChatConversationMember> ChatConversations { get; set; } = new List<ChatConversationMember>();
    public ICollection<ChatMessage> ChatMessages { get; set; } = new List<ChatMessage>();
    public ICollection<ChatMessageReaction> ChatMessageReactions { get; set; } = new List<ChatMessageReaction>();
    public ICollection<Follow> Followers { get; set; } = new List<Follow>();
    public ICollection<Follow> Following { get; set; } = new List<Follow>();
    public ICollection<Story> Stories { get; set; } = new List<Story>();
    public ICollection<StoryView> StoryViews { get; set; } = new List<StoryView>();
    public ICollection<Reel> Reels { get; set; } = new List<Reel>();
    public ICollection<ReelLike> ReelLikes { get; set; } = new List<ReelLike>();
    public ICollection<ReelComment> ReelComments { get; set; } = new List<ReelComment>();
    public ICollection<ReelCommentLike> ReelCommentLikes { get; set; } = new List<ReelCommentLike>();
    public ICollection<ProfileFollowRequest> ReceivedFollowRequests { get; set; } = new List<ProfileFollowRequest>();
    public ICollection<ProfileFollowRequest> SentFollowRequests { get; set; } = new List<ProfileFollowRequest>();
    public ICollection<Notification> Notifications { get; set; } = new List<Notification>();
}
