using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class CommunityService(SocialSezContext dbContext) : ICommunityService
{
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool communitySchemaInitialized;

    public async Task<CommunityDto> CreateAsync(Guid creatorProfileId, CreateCommunityRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var creator = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == creatorProfileId, cancellationToken);
        if (creator is null)
        {
            throw new InvalidOperationException("Creator profile does not exist.");
        }

        var name = NormalizeName(request.Name);
        var description = NormalizeDescription(request.Description);
        var imageUrl = NormalizeImageUrl(request.ImageUrl);
        var slug = await BuildUniqueSlugAsync(name, cancellationToken);

        var community = new Community
        {
            Id = Guid.NewGuid(),
            CreatedByProfileId = creatorProfileId,
            Slug = slug,
            Name = name,
            Description = description,
            ImageUrl = imageUrl,
            IsPrivate = request.IsPrivate,
            CreatedAtUtc = DateTime.UtcNow,
            CreatedByProfile = creator
        };

        var ownerMembership = new CommunityMember
        {
            CommunityId = community.Id,
            ProfileId = creatorProfileId,
            Role = "Owner",
            JoinedAtUtc = DateTime.UtcNow,
            Profile = creator
        };

        community.Members.Add(ownerMembership);

        dbContext.Communities.Add(community);
        await dbContext.SaveChangesAsync(cancellationToken);

        return MapCommunity(community, creatorProfileId, includeMembers: true, memberTake: 20);
    }

    public async Task<CommunityDto?> UpdateAsync(Guid communityId, Guid actorProfileId, UpdateCommunityRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var community = await dbContext.Communities
            .Include(x => x.CreatedByProfile)
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == communityId, cancellationToken);

        if (community is null)
        {
            return null;
        }

        var actorMembership = community.Members.FirstOrDefault(x => x.ProfileId == actorProfileId);
        if (actorMembership is null || (!string.Equals(actorMembership.Role, "Owner", StringComparison.Ordinal) && !string.Equals(actorMembership.Role, "Admin", StringComparison.Ordinal)))
        {
            throw new UnauthorizedAccessException("Only owners or admins can update a community.");
        }

        var name = NormalizeName(request.Name);
        var description = NormalizeDescription(request.Description);
        var imageUrl = NormalizeImageUrl(request.ImageUrl);

        if (!string.Equals(community.Name, name, StringComparison.Ordinal))
        {
            community.Slug = await BuildUniqueSlugAsync(name, cancellationToken, community.Id);
        }

        community.Name = name;
        community.Description = description;
        community.ImageUrl = imageUrl;
        community.IsPrivate = request.IsPrivate;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapCommunity(community, actorProfileId, includeMembers: true, memberTake: 20);
    }

    public async Task<CommunityDto?> GetByIdAsync(Guid communityId, Guid? viewerProfileId = null, int memberTake = 20, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var normalizedMemberTake = Math.Clamp(memberTake, 1, 100);

        var community = await dbContext.Communities
            .Include(x => x.CreatedByProfile)
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == communityId, cancellationToken);

        if (community is null)
        {
            return null;
        }

        var isMember = viewerProfileId.HasValue && community.Members.Any(x => x.ProfileId == viewerProfileId.Value);
        if (community.IsPrivate && !isMember)
        {
            return null;
        }

        return MapCommunity(community, viewerProfileId, includeMembers: true, memberTake: normalizedMemberTake);
    }

    public async Task<CommunityDto?> GetBySlugAsync(string slug, Guid? viewerProfileId = null, int memberTake = 20, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var normalizedSlug = (slug ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedSlug))
        {
            return null;
        }

        var normalizedMemberTake = Math.Clamp(memberTake, 1, 100);

        var community = await dbContext.Communities
            .Include(x => x.CreatedByProfile)
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Slug == normalizedSlug, cancellationToken);

        if (community is null)
        {
            return null;
        }

        var isMember = viewerProfileId.HasValue && community.Members.Any(x => x.ProfileId == viewerProfileId.Value);
        if (community.IsPrivate && !isMember)
        {
            return null;
        }

        return MapCommunity(community, viewerProfileId, includeMembers: true, memberTake: normalizedMemberTake);
    }

    public async Task<IReadOnlyCollection<CommunityDto>> GetMineAsync(Guid profileId, int take = 50, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var normalizedTake = Math.Clamp(take, 1, 100);

        var communities = await dbContext.CommunityMembers
            .Where(x => x.ProfileId == profileId)
            .OrderByDescending(x => x.JoinedAtUtc)
            .Select(x => x.CommunityId)
            .Take(normalizedTake)
            .ToArrayAsync(cancellationToken);

        if (communities.Length == 0)
        {
            return Array.Empty<CommunityDto>();
        }

        var communityRows = await dbContext.Communities
            .Where(x => communities.Contains(x.Id))
            .Include(x => x.CreatedByProfile)
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .ToListAsync(cancellationToken);

        var orderMap = communities
            .Select((id, index) => new { id, index })
            .ToDictionary(x => x.id, x => x.index);

        return communityRows
            .OrderBy(x => orderMap[x.Id])
            .Select(x => MapCommunity(x, profileId, includeMembers: false, memberTake: 0))
            .ToArray();
    }

    public async Task<IReadOnlyCollection<CommunityDto>> DiscoverAsync(Guid? viewerProfileId, string? query = null, int take = 50, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var normalizedTake = Math.Clamp(take, 1, 100);
        var normalizedQuery = query?.Trim();

        var communitiesQuery = dbContext.Communities
            .AsNoTracking()
            .Include(x => x.CreatedByProfile)
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .Where(x => !x.IsPrivate)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(normalizedQuery))
        {
            var lowered = normalizedQuery.ToLowerInvariant();
            communitiesQuery = communitiesQuery.Where(x =>
                x.Name.ToLower().Contains(lowered) ||
                x.Slug.ToLower().Contains(lowered) ||
                (x.Description != null && x.Description.ToLower().Contains(lowered)));
        }

        var communities = await communitiesQuery
            .OrderByDescending(x => x.Members.Count)
            .ThenByDescending(x => x.CreatedAtUtc)
            .Take(normalizedTake)
            .ToListAsync(cancellationToken);

        return communities
            .Select(x => MapCommunity(x, viewerProfileId, includeMembers: false, memberTake: 0))
            .ToArray();
    }

    public async Task<CommunityDto?> JoinAsync(Guid communityId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var profile = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == profileId, cancellationToken);
        if (profile is null)
        {
            throw new InvalidOperationException("Profile does not exist.");
        }

        var community = await dbContext.Communities
            .Include(x => x.CreatedByProfile)
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == communityId, cancellationToken);

        if (community is null)
        {
            return null;
        }

        if (community.IsPrivate)
        {
            throw new InvalidOperationException("This community is private.");
        }

        var existingMembership = community.Members.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingMembership is null)
        {
            community.Members.Add(new CommunityMember
            {
                CommunityId = communityId,
                ProfileId = profileId,
                Role = "Member",
                JoinedAtUtc = DateTime.UtcNow,
                Profile = profile
            });

            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return MapCommunity(community, profileId, includeMembers: true, memberTake: 20);
    }

    public async Task<bool> LeaveAsync(Guid communityId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var community = await dbContext.Communities
            .Include(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == communityId, cancellationToken);

        if (community is null)
        {
            return false;
        }

        var membership = community.Members.FirstOrDefault(x => x.ProfileId == profileId);
        if (membership is null)
        {
            return false;
        }

        var isOwner = string.Equals(membership.Role, "Owner", StringComparison.Ordinal);
        var ownerCount = community.Members.Count(x => string.Equals(x.Role, "Owner", StringComparison.Ordinal));
        if (isOwner && ownerCount <= 1)
        {
            throw new InvalidOperationException("Transfer ownership before leaving this community.");
        }

        dbContext.CommunityMembers.Remove(membership);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<CommunityPostDto?> CreatePostAsync(Guid communityId, CreateCommunityPostRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var community = await dbContext.Communities
            .Include(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == communityId, cancellationToken);

        if (community is null)
        {
            return null;
        }

        var isMember = community.Members.Any(x => x.ProfileId == request.AuthorId);
        if (!isMember)
        {
            throw new UnauthorizedAccessException("Join the community before posting.");
        }

        var author = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == request.AuthorId, cancellationToken);
        if (author is null)
        {
            throw new InvalidOperationException("Author profile does not exist.");
        }

        var content = NormalizePostContent(request.Content);
        var imageUrl = NormalizeImageUrl(request.ImageUrl);
        var pollQuestion = NormalizePollQuestion(request.PollQuestion);
        var pollOptions = NormalizePollOptions(request.PollOptions);

        if (string.IsNullOrWhiteSpace(content) && string.IsNullOrWhiteSpace(imageUrl) && string.IsNullOrWhiteSpace(pollQuestion))
        {
            throw new ArgumentException("Post content, image, or poll is required.", nameof(request));
        }

        if (!string.IsNullOrWhiteSpace(pollQuestion) && pollOptions.Count < 2)
        {
            throw new ArgumentException("Polls require at least two options.", nameof(request));
        }

        var post = new CommunityPost
        {
            Id = Guid.NewGuid(),
            CommunityId = communityId,
            AuthorId = request.AuthorId,
            Content = content,
            ImageUrl = imageUrl,
            CreatedAtUtc = DateTime.UtcNow,
            Author = author
        };

        if (!string.IsNullOrWhiteSpace(pollQuestion))
        {
            post.Poll = new CommunityPoll
            {
                Id = Guid.NewGuid(),
                PostId = post.Id,
                Question = pollQuestion,
                CreatedAtUtc = DateTime.UtcNow,
                Options = pollOptions.Select(option => new CommunityPollOption
                {
                    Id = Guid.NewGuid(),
                    Text = option
                }).ToArray()
            };
        }

        dbContext.CommunityPosts.Add(post);
        await dbContext.SaveChangesAsync(cancellationToken);

        var created = await dbContext.CommunityPosts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == post.Id, cancellationToken);

        return created is null ? null : MapPost(created, request.AuthorId);
    }

    public async Task<IReadOnlyCollection<CommunityPostDto>> GetPostsAsync(Guid communityId, Guid? viewerProfileId, string? query = null, int take = 50, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var community = await dbContext.Communities
            .AsNoTracking()
            .Include(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == communityId, cancellationToken);

        if (community is null)
        {
            return Array.Empty<CommunityPostDto>();
        }

        var isMember = viewerProfileId.HasValue && community.Members.Any(x => x.ProfileId == viewerProfileId.Value);
        if (community.IsPrivate && !isMember)
        {
            return Array.Empty<CommunityPostDto>();
        }

        var normalizedTake = Math.Clamp(take, 1, 100);
        var normalizedQuery = query?.Trim();

        var postsQuery = dbContext.CommunityPosts
            .AsNoTracking()
            .Where(x => x.CommunityId == communityId)
            .Include(x => x.Author)
            .Include(x => x.SavedBy)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(normalizedQuery))
        {
            var lowered = normalizedQuery.ToLowerInvariant();
            postsQuery = postsQuery.Where(x =>
                (x.Content != null && x.Content.ToLower().Contains(lowered))
                || x.Author.Handle.ToLower().Contains(lowered)
                || (x.Poll != null && x.Poll.Question.ToLower().Contains(lowered))
                || (x.Poll != null && x.Poll.Options.Any(option => option.Text.ToLower().Contains(lowered))));
        }

        var posts = await postsQuery
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(normalizedTake)
            .ToArrayAsync(cancellationToken);

        return posts
            .Select(post => MapPost(post, viewerProfileId))
            .ToArray();
    }

    public async Task<CommunityPostDto?> SavePostAsync(Guid communityId, Guid postId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.SavedBy)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var canAccess = !post.Community.IsPrivate || post.Community.Members.Any(x => x.ProfileId == profileId);
        if (!canAccess)
        {
            throw new UnauthorizedAccessException("You cannot save posts from this community.");
        }

        var existing = post.SavedBy.FirstOrDefault(x => x.ProfileId == profileId);
        if (existing is null)
        {
            post.SavedBy.Add(new CommunitySavedPost
            {
                PostId = post.Id,
                ProfileId = profileId,
                SavedAtUtc = DateTime.UtcNow
            });

            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return MapPost(post, profileId);
    }

    public async Task<bool> UnsavePostAsync(Guid communityId, Guid postId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var saved = await dbContext.CommunitySavedPosts
            .FirstOrDefaultAsync(x => x.PostId == postId && x.ProfileId == profileId, cancellationToken);

        if (saved is null)
        {
            return false;
        }

        var postExists = await dbContext.CommunityPosts
            .AsNoTracking()
            .AnyAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (!postExists)
        {
            return false;
        }

        dbContext.CommunitySavedPosts.Remove(saved);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<CommunityPollDto?> VotePollAsync(Guid communityId, Guid pollId, VoteCommunityPollRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var poll = await dbContext.CommunityPolls
            .Include(x => x.Post)
                .ThenInclude(x => x.Community)
                    .ThenInclude(x => x.Members)
            .Include(x => x.Options)
                .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == pollId, cancellationToken);

        if (poll is null || poll.Post.CommunityId != communityId)
        {
            return null;
        }

        var isMember = poll.Post.Community.Members.Any(x => x.ProfileId == request.VoterId);
        if (!isMember)
        {
            throw new UnauthorizedAccessException("Join the community before voting.");
        }

        var selectedOption = poll.Options.FirstOrDefault(x => x.Id == request.OptionId);
        if (selectedOption is null)
        {
            throw new ArgumentException("Poll option does not exist.", nameof(request));
        }

        var existingVote = poll.Options
            .SelectMany(x => x.Votes)
            .FirstOrDefault(x => x.VoterId == request.VoterId);

        if (existingVote is not null && existingVote.OptionId != selectedOption.Id)
        {
            dbContext.CommunityPollVotes.Remove(existingVote);
        }

        if (existingVote is null || existingVote.OptionId != selectedOption.Id)
        {
            selectedOption.Votes.Add(new CommunityPollVote
            {
                OptionId = selectedOption.Id,
                VoterId = request.VoterId,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapPoll(poll, request.VoterId);
    }

    private static string NormalizeName(string? name)
    {
        var normalized = name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Community name is required.", nameof(name));
        }

        if (normalized.Length > 120)
        {
            throw new ArgumentException("Community name cannot exceed 120 characters.", nameof(name));
        }

        return normalized;
    }

    private static string? NormalizeDescription(string? description)
    {
        if (string.IsNullOrWhiteSpace(description))
        {
            return null;
        }

        var normalized = description.Trim();
        if (normalized.Length > 600)
        {
            throw new ArgumentException("Community description cannot exceed 600 characters.", nameof(description));
        }

        return normalized;
    }

    private static string? NormalizeImageUrl(string? imageUrl)
    {
        if (string.IsNullOrWhiteSpace(imageUrl))
        {
            return null;
        }

        var normalized = imageUrl.Trim();
        if (normalized.Length > 1024)
        {
            throw new ArgumentException("Image url cannot exceed 1024 characters.", nameof(imageUrl));
        }

        return normalized;
    }

    private static string? NormalizePostContent(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return null;
        }

        var normalized = content.Trim();
        if (normalized.Length > 5000)
        {
            throw new ArgumentException("Post content cannot exceed 5000 characters.", nameof(content));
        }

        return normalized;
    }

    private static string? NormalizePollQuestion(string? question)
    {
        if (string.IsNullOrWhiteSpace(question))
        {
            return null;
        }

        var normalized = question.Trim();
        if (normalized.Length > 280)
        {
            throw new ArgumentException("Poll question cannot exceed 280 characters.", nameof(question));
        }

        return normalized;
    }

    private static IReadOnlyCollection<string> NormalizePollOptions(IReadOnlyCollection<string>? options)
    {
        if (options is null)
        {
            return Array.Empty<string>();
        }

        return options
            .Select(option => option?.Trim() ?? string.Empty)
            .Where(option => !string.IsNullOrWhiteSpace(option))
            .Select(option =>
            {
                if (option.Length > 160)
                {
                    throw new ArgumentException("Poll option cannot exceed 160 characters.", nameof(options));
                }

                return option;
            })
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(6)
            .ToArray();
    }

    private async Task<string> BuildUniqueSlugAsync(string name, CancellationToken cancellationToken, Guid? excludingCommunityId = null)
    {
        var baseSlug = ToSlug(name);
        if (string.IsNullOrWhiteSpace(baseSlug))
        {
            baseSlug = "community";
        }

        var candidate = baseSlug;
        var suffix = 2;

        while (await dbContext.Communities.AnyAsync(x => x.Slug == candidate && (!excludingCommunityId.HasValue || x.Id != excludingCommunityId.Value), cancellationToken))
        {
            candidate = $"{baseSlug}-{suffix}";
            suffix++;
        }

        return candidate;
    }

    private static string ToSlug(string value)
    {
        var chars = value.ToLowerInvariant()
            .Where(ch => char.IsLetterOrDigit(ch) || char.IsWhiteSpace(ch) || ch == '-' || ch == '_')
            .ToArray();

        var filtered = new string(chars);
        var parts = filtered
            .Split(new[] { ' ', '_' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Trim('-'))
            .Where(part => part.Length > 0);

        var slug = string.Join('-', parts);
        return slug.Length > 60 ? slug[..60] : slug;
    }

    private static CommunityDto MapCommunity(Community community, Guid? viewerProfileId, bool includeMembers, int memberTake)
    {
        var memberships = community.Members
            .OrderBy(member => member.JoinedAtUtc)
            .ToArray();

        var viewerMembership = viewerProfileId.HasValue
            ? memberships.FirstOrDefault(x => x.ProfileId == viewerProfileId.Value)
            : null;

        IReadOnlyCollection<CommunityMemberDto> members = Array.Empty<CommunityMemberDto>();
        if (includeMembers)
        {
            var take = Math.Max(memberTake, 1);
            members = memberships
                .Take(take)
                .Select(member => new CommunityMemberDto(
                    member.ProfileId,
                    member.Profile.Handle,
                    member.Profile.ImageUrl,
                    member.Role,
                    member.JoinedAtUtc))
                .ToArray();
        }

        return new CommunityDto(
            community.Id,
            community.Slug,
            community.Name,
            community.Description,
            community.ImageUrl,
            community.IsPrivate,
            community.CreatedByProfileId,
            community.CreatedByProfile.Handle,
            community.CreatedAtUtc,
            memberships.Length,
            viewerMembership is not null,
            viewerMembership?.Role,
            members);
    }

    private static CommunityPostDto MapPost(CommunityPost post, Guid? viewerProfileId)
    {
        var isSavedByMe = viewerProfileId.HasValue && post.SavedBy.Any(x => x.ProfileId == viewerProfileId.Value);

        return new CommunityPostDto(
            post.Id,
            post.CommunityId,
            post.AuthorId,
            post.Author.Handle,
            post.Author.ImageUrl,
            post.Content,
            post.ImageUrl,
            post.CreatedAtUtc,
            isSavedByMe,
            post.Poll is null ? null : MapPoll(post.Poll, viewerProfileId));
    }

    private static CommunityPollDto MapPoll(CommunityPoll poll, Guid? viewerProfileId)
    {
        var options = poll.Options
            .OrderBy(x => x.Text)
            .Select(option => new CommunityPollOptionDto(
                option.Id,
                option.Text,
                option.Votes.Count,
                viewerProfileId.HasValue && option.Votes.Any(vote => vote.VoterId == viewerProfileId.Value)))
            .ToArray();

        var totalVotes = options.Sum(x => x.VoteCount);
        var hasVotedByMe = options.Any(x => x.VotedByMe);

        return new CommunityPollDto(
            poll.Id,
            poll.Question,
            totalVotes,
            hasVotedByMe,
            options);
    }

    private async Task EnsureCommunitySchemaAsync(CancellationToken cancellationToken)
    {
        if (communitySchemaInitialized || !dbContext.Database.IsSqlite())
        {
            return;
        }

        await SchemaInitLock.WaitAsync(cancellationToken);
        try
        {
            if (communitySchemaInitialized)
            {
                return;
            }

            await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS Communities (
                Id TEXT NOT NULL PRIMARY KEY,
                CreatedByProfileId TEXT NOT NULL,
                Slug TEXT NOT NULL,
                Name TEXT NOT NULL,
                Description TEXT NULL,
                ImageUrl TEXT NULL,
                IsPrivate INTEGER NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (CreatedByProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """, cancellationToken);

            try
            {
                await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE Communities ADD COLUMN ImageUrl TEXT NULL;", cancellationToken);
            }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
            {
            }

            await dbContext.Database.ExecuteSqlRawAsync("CREATE UNIQUE INDEX IF NOT EXISTS IX_Communities_Slug ON Communities (Slug);", cancellationToken);
            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_Communities_CreatedAtUtc ON Communities (CreatedAtUtc);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS CommunityMembers (
                CommunityId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                Role TEXT NOT NULL,
                JoinedAtUtc TEXT NOT NULL,
                PRIMARY KEY (CommunityId, ProfileId),
                FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """, cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityMembers_ProfileId ON CommunityMembers (ProfileId);", cancellationToken);
            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityMembers_CommunityId_Role ON CommunityMembers (CommunityId, Role);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS CommunityPosts (
                Id TEXT NOT NULL PRIMARY KEY,
                CommunityId TEXT NOT NULL,
                AuthorId TEXT NOT NULL,
                Content TEXT NULL,
                ImageUrl TEXT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """, cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPosts_CommunityId_CreatedAtUtc ON CommunityPosts (CommunityId, CreatedAtUtc);", cancellationToken);
            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPosts_AuthorId ON CommunityPosts (AuthorId);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS CommunityPolls (
                Id TEXT NOT NULL PRIMARY KEY,
                PostId TEXT NOT NULL,
                Question TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE
            );
            """, cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("CREATE UNIQUE INDEX IF NOT EXISTS IX_CommunityPolls_PostId ON CommunityPolls (PostId);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS CommunityPollOptions (
                Id TEXT NOT NULL PRIMARY KEY,
                PollId TEXT NOT NULL,
                Text TEXT NOT NULL,
                FOREIGN KEY (PollId) REFERENCES CommunityPolls (Id) ON DELETE CASCADE
            );
            """, cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPollOptions_PollId ON CommunityPollOptions (PollId);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS CommunityPollVotes (
                OptionId TEXT NOT NULL,
                VoterId TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (OptionId, VoterId),
                FOREIGN KEY (OptionId) REFERENCES CommunityPollOptions (Id) ON DELETE CASCADE,
                FOREIGN KEY (VoterId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """, cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPollVotes_VoterId ON CommunityPollVotes (VoterId);", cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS CommunitySavedPosts (
                PostId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                SavedAtUtc TEXT NOT NULL,
                PRIMARY KEY (PostId, ProfileId),
                FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """, cancellationToken);

            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunitySavedPosts_ProfileId ON CommunitySavedPosts (ProfileId);", cancellationToken);
            await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunitySavedPosts_ProfileId_SavedAtUtc ON CommunitySavedPosts (ProfileId, SavedAtUtc);", cancellationToken);

            communitySchemaInitialized = true;
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }
}