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
    public DbSet<Story> Stories => Set<Story>();
    public DbSet<StoryView> StoryViews => Set<StoryView>();
    public DbSet<Reel> Reels => Set<Reel>();
    public DbSet<ReelLike> ReelLikes => Set<ReelLike>();
    public DbSet<ReelComment> ReelComments => Set<ReelComment>();
    public DbSet<ReelCommentLike> ReelCommentLikes => Set<ReelCommentLike>();
    public DbSet<ProfileFollowRequest> ProfileFollowRequests => Set<ProfileFollowRequest>();
    public DbSet<Notification> Notifications => Set<Notification>();

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
            entity.Property(x => x.IsPrivate).HasDefaultValue(false);
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

            entity.HasOne(x => x.Author)
                .WithMany(x => x.Stories)
                .HasForeignKey(x => x.AuthorId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => new { x.AuthorId, x.CreatedAtUtc });
            entity.HasIndex(x => x.ExpiresAtUtc);
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
    }
}
