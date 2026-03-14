namespace SocialSez.Domain.Entities;

public class UserProfile
{
    public Guid Id { get; set; }
    public string Handle { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;
    public string? ImageUrl { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? CountryCode { get; set; }
    public bool MarketingOptIn { get; set; }
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
    public ICollection<FollowedHashtag> FollowedHashtags { get; set; } = new List<FollowedHashtag>();
    public ICollection<Story> Stories { get; set; } = new List<Story>();
    public ICollection<StoryCollection> StoryCollections { get; set; } = new List<StoryCollection>();
    public ICollection<StoryView> StoryViews { get; set; } = new List<StoryView>();
    public ICollection<Reel> Reels { get; set; } = new List<Reel>();
    public ICollection<ReelLike> ReelLikes { get; set; } = new List<ReelLike>();
    public ICollection<ReelComment> ReelComments { get; set; } = new List<ReelComment>();
    public ICollection<ReelCommentLike> ReelCommentLikes { get; set; } = new List<ReelCommentLike>();
    public ICollection<Community> CreatedCommunities { get; set; } = new List<Community>();
    public ICollection<CommunityMember> CommunityMemberships { get; set; } = new List<CommunityMember>();
    public ICollection<CommunityPost> CommunityPosts { get; set; } = new List<CommunityPost>();
    public ICollection<CommunityPostVote> CommunityPostVotes { get; set; } = new List<CommunityPostVote>();
    public ICollection<CommunitySavedPost> SavedCommunityPosts { get; set; } = new List<CommunitySavedPost>();
    public ICollection<CommunityPollVote> CommunityPollVotes { get; set; } = new List<CommunityPollVote>();
    public ICollection<Blog> Blogs { get; set; } = new List<Blog>();
    public ICollection<BlogPost> BlogPosts { get; set; } = new List<BlogPost>();
    public ICollection<BlogPostSave> SavedBlogPosts { get; set; } = new List<BlogPostSave>();
    public ICollection<ProfileFollowRequest> ReceivedFollowRequests { get; set; } = new List<ProfileFollowRequest>();
    public ICollection<ProfileFollowRequest> SentFollowRequests { get; set; } = new List<ProfileFollowRequest>();
    public ICollection<Notification> Notifications { get; set; } = new List<Notification>();
    public ICollection<UserBlock> BlockedProfiles { get; set; } = new List<UserBlock>();
    public ICollection<UserBlock> BlockedByProfiles { get; set; } = new List<UserBlock>();
    public ICollection<UserMute> MutedProfiles { get; set; } = new List<UserMute>();
    public ICollection<UserMute> MutedByProfiles { get; set; } = new List<UserMute>();
    public ICollection<UserReport> ReportsFiled { get; set; } = new List<UserReport>();
    public ICollection<UserReport> ReportsReceived { get; set; } = new List<UserReport>();
    public ICollection<SavedItem> SavedItems { get; set; } = new List<SavedItem>();
    public ICollection<SavedCollection> SavedCollections { get; set; } = new List<SavedCollection>();
}
