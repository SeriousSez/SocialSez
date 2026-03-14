using Microsoft.EntityFrameworkCore;
using SocialSez.Domain.Entities;

namespace SocialSez.Infrastructure;

public class SocialSezContext(DbContextOptions<SocialSezContext> options) : DbContext(options)
{
    public DbSet<AppUser> AppUsers => Set<AppUser>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();
    public DbSet<Post> Posts => Set<Post>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<PostReaction> PostReactions => Set<PostReaction>();
    public DbSet<CommentReaction> CommentReactions => Set<CommentReaction>();
    public DbSet<ChatConversation> ChatConversations => Set<ChatConversation>();
    public DbSet<ChatConversationMember> ChatConversationMembers => Set<ChatConversationMember>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<ChatMessageReaction> ChatMessageReactions => Set<ChatMessageReaction>();
    public DbSet<Follow> Follows => Set<Follow>();
    public DbSet<FollowedHashtag> FollowedHashtags => Set<FollowedHashtag>();
    public DbSet<Story> Stories => Set<Story>();
    public DbSet<StoryCollection> StoryCollections => Set<StoryCollection>();
    public DbSet<StoryCollectionItem> StoryCollectionItems => Set<StoryCollectionItem>();
    public DbSet<StoryView> StoryViews => Set<StoryView>();
    public DbSet<Reel> Reels => Set<Reel>();
    public DbSet<ReelLike> ReelLikes => Set<ReelLike>();
    public DbSet<ReelComment> ReelComments => Set<ReelComment>();
    public DbSet<ReelCommentLike> ReelCommentLikes => Set<ReelCommentLike>();
    public DbSet<ProfileFollowRequest> ProfileFollowRequests => Set<ProfileFollowRequest>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<UserBlock> UserBlocks => Set<UserBlock>();
    public DbSet<UserMute> UserMutes => Set<UserMute>();
    public DbSet<UserReport> UserReports => Set<UserReport>();
    public DbSet<ModerationQueueItem> ModerationQueueItems => Set<ModerationQueueItem>();
    public DbSet<Community> Communities => Set<Community>();
    public DbSet<CommunityMember> CommunityMembers => Set<CommunityMember>();
    public DbSet<CommunityModerationSetting> CommunityModerationSettings => Set<CommunityModerationSetting>();
    public DbSet<CommunityShadowMute> CommunityShadowMutes => Set<CommunityShadowMute>();
    public DbSet<CommunityBanAppeal> CommunityBanAppeals => Set<CommunityBanAppeal>();
    public DbSet<CommunityPost> CommunityPosts => Set<CommunityPost>();
    public DbSet<CommunityPostImage> CommunityPostImages => Set<CommunityPostImage>();
    public DbSet<CommunityPostComment> CommunityPostComments => Set<CommunityPostComment>();
    public DbSet<CommunityPostVote> CommunityPostVotes => Set<CommunityPostVote>();
    public DbSet<CommunityPoll> CommunityPolls => Set<CommunityPoll>();
    public DbSet<CommunityPollOption> CommunityPollOptions => Set<CommunityPollOption>();
    public DbSet<CommunityPollVote> CommunityPollVotes => Set<CommunityPollVote>();
    public DbSet<CommunitySavedPost> CommunitySavedPosts => Set<CommunitySavedPost>();
    public DbSet<SavedItem> SavedItems => Set<SavedItem>();
    public DbSet<SavedCollection> SavedCollections => Set<SavedCollection>();
    public DbSet<SavedCollectionItem> SavedCollectionItems => Set<SavedCollectionItem>();
    public DbSet<Blog> Blogs => Set<Blog>();
    public DbSet<BlogPost> BlogPosts => Set<BlogPost>();
    public DbSet<BlogPostSave> BlogPostSaves => Set<BlogPostSave>();
    public DbSet<UploadedImage> UploadedImages => Set<UploadedImage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.ToTable("AppUsers");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Email).HasMaxLength(255).IsRequired();
            entity.Property(x => x.PasswordHash).HasMaxLength(600).IsRequired();
            entity.HasIndex(x => x.Email).IsUnique();

            entity.HasOne(x => x.Profile)
                .WithOne()
                .HasForeignKey<AppUser>(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.ToTable("RefreshTokens");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();
            entity.HasIndex(x => x.TokenHash).IsUnique();
            entity.HasIndex(x => new { x.AppUserId, x.RevokedAtUtc, x.ExpiresAtUtc });

            entity.HasOne(x => x.User)
                .WithMany(x => x.RefreshTokens)
                .HasForeignKey(x => x.AppUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserProfile>(entity =>
        {
            entity.ToTable("UserProfiles");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Handle).HasMaxLength(40).IsRequired();
            entity.Property(x => x.DisplayName).HasMaxLength(120).IsRequired();
            entity.Property(x => x.Bio).HasMaxLength(500);
            entity.Property(x => x.ImageUrl).HasMaxLength(1024);
            entity.Property(x => x.CountryCode).HasMaxLength(2);
            entity.Property(x => x.MarketingOptIn).HasDefaultValue(false);
            entity.Property(x => x.IsPrivate).HasDefaultValue(false);
            entity.Property(x => x.LastHandleChangeAtUtc);
            entity.HasIndex(x => x.Handle).IsUnique();
        });

        modelBuilder.Entity<Post>(entity =>
        {
            entity.ToTable("Posts");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).HasMaxLength(1000).IsRequired();
            entity.Property(x => x.ImageUrl).HasMaxLength(1024);
            entity.HasOne(x => x.Author)
                .WithMany(x => x.Posts)
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.AuthorId, x.CreatedAtUtc });
        });

        modelBuilder.Entity<UploadedImage>(entity =>
        {
            entity.ToTable("UploadedImages");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.ContentType).HasMaxLength(120).IsRequired();
            entity.Property(x => x.OriginalFileName).HasMaxLength(260).IsRequired();
            entity.Property(x => x.FileExtension).HasMaxLength(16).IsRequired();
            entity.Property(x => x.Content).IsRequired();

            entity.HasOne(x => x.UploadedByProfile)
                .WithMany()
                .HasForeignKey(x => x.UploadedByProfileId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => x.CreatedAtUtc);
            entity.HasIndex(x => x.UploadedByProfileId);
        });

        modelBuilder.Entity<Comment>(entity =>
        {
            entity.ToTable("Comments");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).HasMaxLength(500).IsRequired();

            entity.HasOne(x => x.Post)
                .WithMany(x => x.Comments)
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Author)
                .WithMany()
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.ParentComment)
                .WithMany(x => x.Replies)
                .HasForeignKey(x => x.ParentCommentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => new { x.PostId, x.CreatedAtUtc });
            entity.HasIndex(x => x.ParentCommentId);
        });

        modelBuilder.Entity<CommentReaction>(entity =>
        {
            entity.ToTable("CommentReactions");
            entity.HasKey(x => new { x.CommentId, x.ProfileId });
            entity.Property(x => x.Type).HasMaxLength(24).IsRequired();

            entity.HasOne(x => x.Comment)
                .WithMany(x => x.Reactions)
                .HasForeignKey(x => x.CommentId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.CommentReactions)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.CommentId, x.Type });
        });

        modelBuilder.Entity<PostReaction>(entity =>
        {
            entity.ToTable("PostReactions");
            entity.HasKey(x => new { x.PostId, x.ProfileId });
            entity.Property(x => x.Type).HasMaxLength(24).IsRequired();

            entity.HasOne(x => x.Post)
                .WithMany(x => x.Reactions)
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.Reactions)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.PostId, x.Type });
        });

        modelBuilder.Entity<Follow>(entity =>
        {
            entity.ToTable("Follows");
            entity.HasKey(x => new { x.FollowerId, x.FollowedId });

            entity.HasOne(x => x.Follower)
                .WithMany(x => x.Following)
                .HasForeignKey(x => x.FollowerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.Followed)
                .WithMany(x => x.Followers)
                .HasForeignKey(x => x.FollowedId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<FollowedHashtag>(entity =>
        {
            entity.ToTable("FollowedHashtags");
            entity.HasKey(x => new { x.ProfileId, x.Tag });
            entity.Property(x => x.Tag).HasMaxLength(64).IsRequired();

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.FollowedHashtags)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.ProfileId, x.CreatedAtUtc });
        });

        modelBuilder.Entity<ChatConversation>(entity =>
        {
            entity.ToTable("ChatConversations");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Title).HasMaxLength(120);

            entity.HasOne(x => x.CreatedByProfile)
                .WithMany(x => x.CreatedConversations)
                .HasForeignKey(x => x.CreatedByProfileId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => x.CreatedAtUtc);
        });

        modelBuilder.Entity<ChatConversationMember>(entity =>
        {
            entity.ToTable("ChatConversationMembers");
            entity.HasKey(x => new { x.ConversationId, x.ProfileId });
            entity.Property(x => x.IsMuted).HasDefaultValue(false);

            entity.HasOne(x => x.Conversation)
                .WithMany(x => x.Members)
                .HasForeignKey(x => x.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.ChatConversations)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ProfileId);
        });

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.ToTable("ChatMessages");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).HasMaxLength(4000).IsRequired();

            entity.HasOne(x => x.Conversation)
                .WithMany(x => x.Messages)
                .HasForeignKey(x => x.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.AuthorProfile)
                .WithMany(x => x.ChatMessages)
                .HasForeignKey(x => x.AuthorProfileId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => new { x.ConversationId, x.CreatedAtUtc });
        });

        modelBuilder.Entity<ChatMessageReaction>(entity =>
        {
            entity.ToTable("ChatMessageReactions");
            entity.HasKey(x => new { x.MessageId, x.ProfileId });
            entity.Property(x => x.Type).HasMaxLength(24).IsRequired();

            entity.HasOne(x => x.Message)
                .WithMany(x => x.Reactions)
                .HasForeignKey(x => x.MessageId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.ChatMessageReactions)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.MessageId, x.Type });
        });

        modelBuilder.Entity<Story>(entity =>
        {
            entity.ToTable("Stories");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Caption).HasMaxLength(300);
            entity.Property(x => x.MediaUrl).HasMaxLength(1024).IsRequired();
            entity.Property(x => x.ThumbnailUrl).HasMaxLength(1024);

            entity.HasOne(x => x.Author)
                .WithMany(x => x.Stories)
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.AuthorId, x.CreatedAtUtc });
            entity.HasIndex(x => x.ExpiresAtUtc);
        });

        modelBuilder.Entity<StoryCollection>(entity =>
        {
            entity.ToTable("StoryCollections");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(80).IsRequired();

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.StoryCollections)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.ProfileId, x.CreatedAtUtc });
        });

        modelBuilder.Entity<StoryCollectionItem>(entity =>
        {
            entity.ToTable("StoryCollectionItems");
            entity.HasKey(x => new { x.CollectionId, x.StoryId });

            entity.HasOne(x => x.Collection)
                .WithMany(x => x.Items)
                .HasForeignKey(x => x.CollectionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Story)
                .WithMany(x => x.CollectionItems)
                .HasForeignKey(x => x.StoryId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.CollectionId, x.AddedAtUtc });
            entity.HasIndex(x => x.StoryId);
        });

        modelBuilder.Entity<StoryView>(entity =>
        {
            entity.ToTable("StoryViews");
            entity.HasKey(x => new { x.StoryId, x.ViewerId });

            entity.HasOne(x => x.Story)
                .WithMany(x => x.Views)
                .HasForeignKey(x => x.StoryId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Viewer)
                .WithMany(x => x.StoryViews)
                .HasForeignKey(x => x.ViewerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ViewerId);
        });

        modelBuilder.Entity<Reel>(entity =>
        {
            entity.ToTable("Reels");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Caption).HasMaxLength(500);
            entity.Property(x => x.VideoUrl).HasMaxLength(1024).IsRequired();
            entity.Property(x => x.ThumbnailUrl).HasMaxLength(1024);

            entity.HasOne(x => x.Author)
                .WithMany(x => x.Reels)
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.CreatedAtUtc);
            entity.HasIndex(x => x.AuthorId);
        });

        modelBuilder.Entity<ReelLike>(entity =>
        {
            entity.ToTable("ReelLikes");
            entity.HasKey(x => new { x.ReelId, x.ProfileId });

            entity.HasOne(x => x.Reel)
                .WithMany(x => x.Likes)
                .HasForeignKey(x => x.ReelId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.ReelLikes)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ProfileId);
        });

        modelBuilder.Entity<ReelComment>(entity =>
        {
            entity.ToTable("ReelComments");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).HasMaxLength(500).IsRequired();

            entity.HasOne(x => x.Reel)
                .WithMany(x => x.Comments)
                .HasForeignKey(x => x.ReelId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Author)
                .WithMany(x => x.ReelComments)
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.ParentComment)
                .WithMany(x => x.Replies)
                .HasForeignKey(x => x.ParentCommentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => new { x.ReelId, x.CreatedAtUtc });
            entity.HasIndex(x => x.AuthorId);
            entity.HasIndex(x => x.ParentCommentId);
        });

        modelBuilder.Entity<ReelCommentLike>(entity =>
        {
            entity.ToTable("ReelCommentLikes");
            entity.HasKey(x => new { x.ReelCommentId, x.ProfileId });

            entity.HasOne(x => x.ReelComment)
                .WithMany(x => x.Likes)
                .HasForeignKey(x => x.ReelCommentId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.ReelCommentLikes)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ProfileId);
        });

        modelBuilder.Entity<ProfileFollowRequest>(entity =>
        {
            entity.ToTable("ProfileFollowRequests");
            entity.HasKey(x => new { x.FollowerId, x.FollowedId });
            entity.Property(x => x.Status).HasMaxLength(16).IsRequired();

            entity.HasOne(x => x.Follower)
                .WithMany(x => x.SentFollowRequests)
                .HasForeignKey(x => x.FollowerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Followed)
                .WithMany(x => x.ReceivedFollowRequests)
                .HasForeignKey(x => x.FollowedId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.FollowedId, x.Status, x.CreatedAtUtc });
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.ToTable("Notifications");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Type).HasMaxLength(64).IsRequired();
            entity.Property(x => x.Message).HasMaxLength(500).IsRequired();
            entity.Property(x => x.ReferenceId).HasMaxLength(128);

            entity.HasOne(x => x.Recipient)
                .WithMany(x => x.Notifications)
                .HasForeignKey(x => x.RecipientId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Actor)
                .WithMany()
                .HasForeignKey(x => x.ActorId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(x => new { x.RecipientId, x.IsRead, x.CreatedAtUtc });
        });

        modelBuilder.Entity<UserBlock>(entity =>
        {
            entity.ToTable("UserBlocks");
            entity.HasKey(x => new { x.BlockerId, x.BlockedId });

            entity.HasOne(x => x.Blocker)
                .WithMany(x => x.BlockedProfiles)
                .HasForeignKey(x => x.BlockerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.Blocked)
                .WithMany(x => x.BlockedByProfiles)
                .HasForeignKey(x => x.BlockedId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => x.BlockedId);
        });

        modelBuilder.Entity<UserMute>(entity =>
        {
            entity.ToTable("UserMutes");
            entity.HasKey(x => new { x.MuterId, x.MutedId });

            entity.HasOne(x => x.Muter)
                .WithMany(x => x.MutedProfiles)
                .HasForeignKey(x => x.MuterId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.Muted)
                .WithMany(x => x.MutedByProfiles)
                .HasForeignKey(x => x.MutedId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => x.MutedId);
        });

        modelBuilder.Entity<UserReport>(entity =>
        {
            entity.ToTable("UserReports");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Reason).HasMaxLength(100).IsRequired();
            entity.Property(x => x.Details).HasMaxLength(1000);
            entity.Property(x => x.Status).HasMaxLength(24).IsRequired();

            entity.HasOne(x => x.Reporter)
                .WithMany(x => x.ReportsFiled)
                .HasForeignKey(x => x.ReporterId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.TargetProfile)
                .WithMany(x => x.ReportsReceived)
                .HasForeignKey(x => x.TargetProfileId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.TargetPost)
                .WithMany()
                .HasForeignKey(x => x.TargetPostId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.TargetReel)
                .WithMany()
                .HasForeignKey(x => x.TargetReelId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.TargetStory)
                .WithMany()
                .HasForeignKey(x => x.TargetStoryId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.TargetComment)
                .WithMany()
                .HasForeignKey(x => x.TargetCommentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.TargetReelComment)
                .WithMany()
                .HasForeignKey(x => x.TargetReelCommentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.TargetMessage)
                .WithMany()
                .HasForeignKey(x => x.TargetMessageId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => new { x.TargetProfileId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.ReporterId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.TargetPostId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.TargetReelId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.TargetStoryId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.TargetCommentId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.TargetReelCommentId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.TargetMessageId, x.CreatedAtUtc });
        });

        modelBuilder.Entity<ModerationQueueItem>(entity =>
        {
            entity.ToTable("ModerationQueueItems");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.SourceType).HasMaxLength(40).IsRequired();
            entity.Property(x => x.TriggerType).HasMaxLength(40).IsRequired();
            entity.Property(x => x.LinkUrl).HasMaxLength(2048);
            entity.Property(x => x.MatchedKeyword).HasMaxLength(80);
            entity.Property(x => x.ContentSnippet).HasMaxLength(500);
            entity.Property(x => x.Status).HasMaxLength(24).IsRequired();
            entity.Property(x => x.Resolution).HasMaxLength(32);
            entity.Property(x => x.ResolutionNote).HasMaxLength(1000);

            entity.HasOne(x => x.Community)
                .WithMany()
                .HasForeignKey(x => x.CommunityId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(x => x.Reporter)
                .WithMany()
                .HasForeignKey(x => x.ReporterId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(x => x.TargetProfile)
                .WithMany()
                .HasForeignKey(x => x.TargetProfileId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(x => x.ReviewedByProfile)
                .WithMany()
                .HasForeignKey(x => x.ReviewedByProfileId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(x => new { x.CommunityId, x.Status, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.Status, x.CreatedAtUtc });
        });

        modelBuilder.Entity<Community>(entity =>
        {
            entity.ToTable("Communities");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Slug).HasMaxLength(60).IsRequired();
            entity.Property(x => x.Name).HasMaxLength(120).IsRequired();
            entity.Property(x => x.Description).HasMaxLength(600);
            entity.Property(x => x.RulesJson).HasMaxLength(8000);
            entity.Property(x => x.ImageUrl).HasMaxLength(1024);
            entity.Property(x => x.IsPrivate).HasDefaultValue(false);

            entity.HasOne(x => x.CreatedByProfile)
                .WithMany(x => x.CreatedCommunities)
                .HasForeignKey(x => x.CreatedByProfileId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => x.Slug).IsUnique();
            entity.HasIndex(x => x.CreatedAtUtc);
        });

        modelBuilder.Entity<CommunityMember>(entity =>
        {
            entity.ToTable("CommunityMembers");
            entity.HasKey(x => new { x.CommunityId, x.ProfileId });
            entity.Property(x => x.Role).HasMaxLength(24).IsRequired();
            entity.Property(x => x.MutedUntilUtc);

            entity.HasOne(x => x.Community)
                .WithMany(x => x.Members)
                .HasForeignKey(x => x.CommunityId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.CommunityMemberships)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ProfileId);
            entity.HasIndex(x => new { x.CommunityId, x.Role });
        });

        modelBuilder.Entity<CommunityModerationSetting>(entity =>
        {
            entity.ToTable("CommunityModerationSettings");
            entity.HasKey(x => x.CommunityId);
            entity.Property(x => x.RulePreset).HasMaxLength(24).IsRequired();
            entity.Property(x => x.KeywordFiltersJson).HasMaxLength(4000);

            entity.HasOne(x => x.Community)
                .WithOne()
                .HasForeignKey<CommunityModerationSetting>(x => x.CommunityId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CommunityShadowMute>(entity =>
        {
            entity.ToTable("CommunityShadowMutes");
            entity.HasKey(x => new { x.CommunityId, x.ProfileId });
            entity.Property(x => x.Reason).HasMaxLength(300);

            entity.HasOne(x => x.Community)
                .WithMany()
                .HasForeignKey(x => x.CommunityId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany()
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.CreatedByProfile)
                .WithMany()
                .HasForeignKey(x => x.CreatedByProfileId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => x.ProfileId);
            entity.HasIndex(x => new { x.CommunityId, x.ExpiresAtUtc });
        });

        modelBuilder.Entity<CommunityBanAppeal>(entity =>
        {
            entity.ToTable("CommunityBanAppeals");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Reason).HasMaxLength(1000).IsRequired();
            entity.Property(x => x.Status).HasMaxLength(24).IsRequired();
            entity.Property(x => x.ResolutionNote).HasMaxLength(1000);

            entity.HasOne(x => x.Community)
                .WithMany()
                .HasForeignKey(x => x.CommunityId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany()
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.ReviewedByProfile)
                .WithMany()
                .HasForeignKey(x => x.ReviewedByProfileId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(x => new { x.CommunityId, x.Status, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.ProfileId, x.CreatedAtUtc });
        });

        modelBuilder.Entity<CommunityPost>(entity =>
        {
            entity.ToTable("CommunityPosts");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Title).HasMaxLength(220);
            entity.Property(x => x.LinkUrl).HasMaxLength(2048);
            entity.Property(x => x.Content).HasMaxLength(5000);
            entity.Property(x => x.MediaContent).HasMaxLength(5000);
            entity.Property(x => x.ImageUrl).HasMaxLength(1024);

            entity.HasOne(x => x.Community)
                .WithMany(x => x.Posts)
                .HasForeignKey(x => x.CommunityId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Author)
                .WithMany(x => x.CommunityPosts)
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => new { x.CommunityId, x.CreatedAtUtc });
            entity.HasIndex(x => x.AuthorId);
        });

        modelBuilder.Entity<CommunityPostImage>(entity =>
        {
            entity.ToTable("CommunityPostImages");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Url).HasMaxLength(1024).IsRequired();
            entity.Property(x => x.SortOrder).HasDefaultValue(0);

            entity.HasOne(x => x.Post)
                .WithMany(x => x.Images)
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.PostId, x.SortOrder });
        });

        modelBuilder.Entity<CommunityPostComment>(entity =>
        {
            entity.ToTable("CommunityPostComments");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).HasMaxLength(500).IsRequired();

            entity.HasOne(x => x.Post)
                .WithMany(x => x.Comments)
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Author)
                .WithMany()
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(x => x.ParentComment)
                .WithMany()
                .HasForeignKey(x => x.ParentCommentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => new { x.PostId, x.CreatedAtUtc });
            entity.HasIndex(x => x.AuthorId);
            entity.HasIndex(x => x.ParentCommentId);
        });

        modelBuilder.Entity<CommunityPostVote>(entity =>
        {
            entity.ToTable("CommunityPostVotes");
            entity.HasKey(x => new { x.PostId, x.ProfileId });
            entity.Property(x => x.Type).HasMaxLength(16).IsRequired();

            entity.HasOne(x => x.Post)
                .WithMany(x => x.Votes)
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.CommunityPostVotes)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.PostId, x.Type });
            entity.HasIndex(x => x.ProfileId);
        });

        modelBuilder.Entity<CommunityPoll>(entity =>
        {
            entity.ToTable("CommunityPolls");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Question).HasMaxLength(280).IsRequired();

            entity.HasOne(x => x.Post)
                .WithOne(x => x.Poll)
                .HasForeignKey<CommunityPoll>(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.PostId).IsUnique();
        });

        modelBuilder.Entity<CommunityPollOption>(entity =>
        {
            entity.ToTable("CommunityPollOptions");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Text).HasMaxLength(160).IsRequired();

            entity.HasOne(x => x.Poll)
                .WithMany(x => x.Options)
                .HasForeignKey(x => x.PollId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.PollId);
        });

        modelBuilder.Entity<CommunityPollVote>(entity =>
        {
            entity.ToTable("CommunityPollVotes");
            entity.HasKey(x => new { x.OptionId, x.VoterId });

            entity.HasOne(x => x.Option)
                .WithMany(x => x.Votes)
                .HasForeignKey(x => x.OptionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Voter)
                .WithMany(x => x.CommunityPollVotes)
                .HasForeignKey(x => x.VoterId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.VoterId);
        });

        modelBuilder.Entity<CommunitySavedPost>(entity =>
        {
            entity.ToTable("CommunitySavedPosts");
            entity.HasKey(x => new { x.PostId, x.ProfileId });

            entity.HasOne(x => x.Post)
                .WithMany(x => x.SavedBy)
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.SavedCommunityPosts)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ProfileId);
            entity.HasIndex(x => new { x.ProfileId, x.SavedAtUtc });
        });

        modelBuilder.Entity<Blog>(entity =>
        {
            entity.ToTable("Blogs");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Slug).HasMaxLength(80).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(160).IsRequired();
            entity.Property(x => x.Description).HasMaxLength(1000);
            entity.Property(x => x.ThemeConfigJson).HasMaxLength(12000);
            entity.Property(x => x.IsPublic).HasDefaultValue(true);
            entity.Property(x => x.AllowLikes).HasDefaultValue(true);
            entity.Property(x => x.AllowComments).HasDefaultValue(true);
            entity.Property(x => x.AllowShares).HasDefaultValue(true);
            entity.Property(x => x.AllowEmbeds).HasDefaultValue(true);

            entity.HasOne(x => x.OwnerProfile)
                .WithMany(x => x.Blogs)
                .HasForeignKey(x => x.OwnerProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.OwnerProfileId, x.Slug }).IsUnique();
            entity.HasIndex(x => new { x.OwnerProfileId, x.UpdatedAtUtc });
        });

        modelBuilder.Entity<BlogPost>(entity =>
        {
            entity.ToTable("BlogPosts");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Slug).HasMaxLength(120).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(220).IsRequired();
            entity.Property(x => x.Content).HasMaxLength(200000).IsRequired();
            entity.Property(x => x.Excerpt).HasMaxLength(800);
            entity.Property(x => x.CoverImageUrl).HasMaxLength(2048);
            entity.Property(x => x.TagsJson).HasMaxLength(4000);
            entity.Property(x => x.IsPublished).HasDefaultValue(false);

            entity.HasOne(x => x.Blog)
                .WithMany(x => x.Posts)
                .HasForeignKey(x => x.BlogId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.AuthorProfile)
                .WithMany(x => x.BlogPosts)
                .HasForeignKey(x => x.AuthorProfileId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => new { x.BlogId, x.Slug }).IsUnique();
            entity.HasIndex(x => new { x.BlogId, x.IsPublished, x.PublishedAtUtc });
        });

        modelBuilder.Entity<BlogPostSave>(entity =>
        {
            entity.ToTable("BlogPostSaves");
            entity.HasKey(x => new { x.PostId, x.ProfileId });

            entity.HasOne(x => x.Post)
                .WithMany(x => x.SavedBy)
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.SavedBlogPosts)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ProfileId);
            entity.HasIndex(x => new { x.ProfileId, x.SavedAtUtc });
        });

        modelBuilder.Entity<SavedItem>(entity =>
        {
            entity.ToTable("SavedItems");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.ItemType).HasMaxLength(32).IsRequired();

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.SavedItems)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Post)
                .WithMany()
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired(false);

            entity.HasOne(x => x.Reel)
                .WithMany()
                .HasForeignKey(x => x.ReelId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired(false);

            entity.HasOne(x => x.CommunityPost)
                .WithMany()
                .HasForeignKey(x => x.CommunityPostId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired(false);

            entity.HasOne(x => x.BlogPost)
                .WithMany()
                .HasForeignKey(x => x.BlogPostId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired(false);

            entity.HasIndex(x => x.ProfileId);
            entity.HasIndex(x => new { x.ProfileId, x.PostId }).IsUnique().HasFilter("PostId IS NOT NULL");
            entity.HasIndex(x => new { x.ProfileId, x.ReelId }).IsUnique().HasFilter("ReelId IS NOT NULL");
            entity.HasIndex(x => new { x.ProfileId, x.CommunityPostId }).IsUnique().HasFilter("CommunityPostId IS NOT NULL");
            entity.HasIndex(x => new { x.ProfileId, x.BlogPostId }).IsUnique().HasFilter("BlogPostId IS NOT NULL");
            entity.HasIndex(x => new { x.ProfileId, x.SavedAtUtc });
        });

        modelBuilder.Entity<SavedCollection>(entity =>
        {
            entity.ToTable("SavedCollections");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(100).IsRequired();

            entity.HasOne(x => x.Profile)
                .WithMany(x => x.SavedCollections)
                .HasForeignKey(x => x.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.ProfileId);
        });

        modelBuilder.Entity<SavedCollectionItem>(entity =>
        {
            entity.ToTable("SavedCollectionItems");
            entity.HasKey(x => new { x.CollectionId, x.SavedItemId });

            entity.HasOne(x => x.Collection)
                .WithMany(x => x.Items)
                .HasForeignKey(x => x.CollectionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.SavedItem)
                .WithMany(x => x.CollectionItems)
                .HasForeignKey(x => x.SavedItemId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.SavedItemId);
        });
    }
}
