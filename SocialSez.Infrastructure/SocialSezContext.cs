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
    public DbSet<Follow> Follows => Set<Follow>();

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

            entity.HasIndex(x => new { x.PostId, x.CreatedAtUtc });
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
    }
}
