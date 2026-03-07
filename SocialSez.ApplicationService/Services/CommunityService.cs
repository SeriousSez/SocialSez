using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Caching.Memory;
using System.Text.Json;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class CommunityService(SocialSezContext dbContext, IMemoryCache memoryCache) : ICommunityService
{
    private const int MaxCommunityCommentLength = 500;
    private const string UpvoteType = "Upvote";
    private const string DownvoteType = "Downvote";
    private const string OwnerRole = "Owner";
    private const string AdminRole = "Admin";
    private const string ModeratorRole = "Moderator";
    private const string MemberRole = "Member";
    private static readonly int[] AllowedTimeoutDays = [1, 7, 30];
    private static readonly SemaphoreSlim SchemaInitLock = new(1, 1);
    private static volatile bool communitySchemaInitialized;
    private static readonly TimeSpan SearchCacheTtl = TimeSpan.FromSeconds(30);

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
        var rules = NormalizeCommunityRules(request.Rules);
        var imageUrl = NormalizeImageUrl(request.ImageUrl);
        var slug = await BuildUniqueSlugAsync(name, cancellationToken);

        var community = new Community
        {
            Id = Guid.NewGuid(),
            CreatedByProfileId = creatorProfileId,
            Slug = slug,
            Name = name,
            Description = description,
            RulesJson = SerializeCommunityRules(rules),
            ImageUrl = imageUrl,
            IsPrivate = request.IsPrivate,
            CreatedAtUtc = DateTime.UtcNow,
            CreatedByProfile = creator
        };

        var ownerMembership = new CommunityMember
        {
            CommunityId = community.Id,
            ProfileId = creatorProfileId,
            Role = OwnerRole,
            JoinedAtUtc = DateTime.UtcNow,
            Profile = creator
        };

        community.Members.Add(ownerMembership);

        dbContext.Communities.Add(community);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();

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
        if (actorMembership is null || !CanManageCommunity(actorMembership.Role))
        {
            throw new UnauthorizedAccessException("Only owners or admins can update a community.");
        }

        var name = NormalizeName(request.Name);
        var description = NormalizeDescription(request.Description);
        var rules = NormalizeCommunityRules(request.Rules);
        var imageUrl = NormalizeImageUrl(request.ImageUrl);

        if (!string.Equals(community.Name, name, StringComparison.Ordinal))
        {
            community.Slug = await BuildUniqueSlugAsync(name, cancellationToken, community.Id);
        }

        community.Name = name;
        community.Description = description;
        community.RulesJson = SerializeCommunityRules(rules);
        community.ImageUrl = imageUrl;
        community.IsPrivate = request.IsPrivate;

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapCommunity(community, actorProfileId, includeMembers: true, memberTake: 20);
    }

    public async Task<CommunityDto?> GetByIdAsync(Guid communityId, Guid? viewerProfileId = null, int memberTake = 20, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var normalizedMemberTake = Math.Clamp(memberTake, 1, 1000);

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

        var normalizedMemberTake = Math.Clamp(memberTake, 1, 1000);

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
        var normalizedQuery = DiscoverySearchBackend.NormalizeQuery(query);
        var expandedTerms = DiscoverySearchBackend.ExpandTerms(normalizedQuery);
        var candidateTake = Math.Clamp(normalizedTake * 4, normalizedTake, 320);

        var cacheKey = $"community:discover:v3:cv={SearchCacheVersionStamp.CommunityVersion}:viewer={viewerProfileId?.ToString() ?? "anon"}:q={normalizedQuery ?? string.Empty}:take={normalizedTake}";
        return await SearchResultCache.GetOrCreateAsync(memoryCache, cacheKey, SearchCacheTtl, async () =>
        {
            var communitiesQuery = dbContext.Communities
                .AsNoTracking()
                .Include(x => x.CreatedByProfile)
                .Include(x => x.Members)
                    .ThenInclude(x => x.Profile)
                .Where(x => !x.IsPrivate)
                .AsQueryable();

            var candidates = await communitiesQuery
                .OrderByDescending(x => x.Members.Count)
                .ThenByDescending(x => x.CreatedAtUtc)
                .Take(candidateTake)
                .ToListAsync(cancellationToken);

            var communities = expandedTerms.Count > 0
                ? candidates
                    .Select(community => new
                    {
                        Community = community,
                        Score = DiscoverySearchBackend.ScoreFields(expandedTerms,
                            (community.Name, 1.8),
                            (community.Slug, 1.4),
                            (community.Description, 1.2),
                            (community.CreatedByProfile.Handle, 1.0))
                            + Math.Min(community.Members.Count, 1200) / 20d
                    })
                    .Where(x => x.Score > 0)
                    .OrderByDescending(x => x.Score)
                    .ThenByDescending(x => x.Community.Members.Count)
                    .ThenBy(x => x.Community.Name)
                    .Take(normalizedTake)
                    .Select(x => x.Community)
                    .ToList()
                : candidates.Take(normalizedTake).ToList();

            return communities
                .Select(x => MapCommunity(x, viewerProfileId, includeMembers: false, memberTake: 0))
                .ToArray();
        });
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
                Role = MemberRole,
                JoinedAtUtc = DateTime.UtcNow,
                Profile = profile
            });

            await dbContext.SaveChangesAsync(cancellationToken);
            SearchCacheVersionStamp.BumpCommunity();
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

        var isOwner = string.Equals(membership.Role, OwnerRole, StringComparison.Ordinal);
        var ownerCount = community.Members.Count(x => string.Equals(x.Role, OwnerRole, StringComparison.Ordinal));
        if (isOwner && ownerCount <= 1)
        {
            throw new InvalidOperationException("Transfer ownership before leaving this community.");
        }

        dbContext.CommunityMembers.Remove(membership);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return true;
    }

    public async Task<CommunityDto?> UpdateMemberRoleAsync(Guid communityId, Guid actorProfileId, Guid memberProfileId, UpdateCommunityMemberRoleRequest request, CancellationToken cancellationToken = default)
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
        if (actorMembership is null || !CanManageCommunity(actorMembership.Role))
        {
            throw new UnauthorizedAccessException("Only owners or admins can manage moderators.");
        }

        var member = community.Members.FirstOrDefault(x => x.ProfileId == memberProfileId);
        if (member is null)
        {
            throw new InvalidOperationException("User is not a member of this community.");
        }

        if (member.ProfileId == actorProfileId)
        {
            throw new InvalidOperationException("You cannot change your own role.");
        }

        if (string.Equals(member.Role, OwnerRole, StringComparison.Ordinal) || string.Equals(member.Role, AdminRole, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Owner/Admin roles cannot be changed with this action.");
        }

        var normalizedRole = NormalizeManageableMemberRole(request.Role);
        member.Role = normalizedRole;

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapCommunity(community, actorProfileId, includeMembers: true, memberTake: 20);
    }

    public async Task<CommunityDto?> TimeoutMemberAsync(Guid communityId, Guid actorProfileId, Guid memberProfileId, TimeoutCommunityMemberRequest request, CancellationToken cancellationToken = default)
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
        if (actorMembership is null || !CanManageCommunity(actorMembership.Role))
        {
            throw new UnauthorizedAccessException("Only owners or admins can timeout members.");
        }

        var member = community.Members.FirstOrDefault(x => x.ProfileId == memberProfileId);
        if (member is null)
        {
            throw new InvalidOperationException("User is not a member of this community.");
        }

        if (member.ProfileId == actorProfileId)
        {
            throw new InvalidOperationException("You cannot timeout yourself.");
        }

        if (string.Equals(member.Role, OwnerRole, StringComparison.Ordinal) || string.Equals(member.Role, AdminRole, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Owner/Admin accounts cannot be timed out with this action.");
        }

        var durationDays = NormalizeTimeoutDurationDays(request.DurationDays);
        member.MutedUntilUtc = DateTime.UtcNow.AddDays(durationDays);

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapCommunity(community, actorProfileId, includeMembers: true, memberTake: 20);
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

        var membership = community.Members.FirstOrDefault(x => x.ProfileId == request.AuthorId);
        if (membership is null)
        {
            throw new UnauthorizedAccessException("Join the community before posting.");
        }

        if (IsMemberTimedOut(membership))
        {
            throw new UnauthorizedAccessException("You are currently timed out in this community and cannot create posts.");
        }

        var author = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == request.AuthorId, cancellationToken);
        if (author is null)
        {
            throw new InvalidOperationException("Author profile does not exist.");
        }

        var content = NormalizePostContent(request.Content);
        var title = NormalizePostTitle(request.Title);
        var linkUrl = NormalizeLinkUrl(request.LinkUrl);
        var imageUrls = NormalizePostImageUrls(request.ImageUrls);
        var imageUrl = imageUrls.FirstOrDefault();
        var pollQuestion = NormalizePollQuestion(request.PollQuestion);
        var pollOptions = NormalizePollOptions(request.PollOptions);

        if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(content) && string.IsNullOrWhiteSpace(linkUrl) && imageUrls.Count == 0 && string.IsNullOrWhiteSpace(pollQuestion))
        {
            throw new ArgumentException("Post title, content, link, image, or poll is required.", nameof(request));
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
            Title = title,
            LinkUrl = linkUrl,
            Content = content,
            ImageUrl = imageUrl,
            CreatedAtUtc = DateTime.UtcNow,
            Author = author,
            Images = imageUrls.Select((url, index) => new CommunityPostImage
            {
                Id = Guid.NewGuid(),
                Url = url,
                SortOrder = index
            }).ToArray()
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
        SearchCacheVersionStamp.BumpCommunity();

        var created = await dbContext.CommunityPosts
            .AsNoTracking()
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == post.Id, cancellationToken);

        return created is null ? null : MapPost(created, request.AuthorId);
    }

    public async Task<CommunityPostDto?> AddCommentAsync(Guid communityId, Guid postId, CreateCommunityPostCommentRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.SavedBy)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var membership = post.Community.Members.FirstOrDefault(x => x.ProfileId == request.AuthorId);
        if (membership is null)
        {
            throw new UnauthorizedAccessException("Join the community before commenting.");
        }

        if (IsMemberTimedOut(membership))
        {
            throw new UnauthorizedAccessException("You are currently timed out in this community and cannot comment.");
        }

        var author = await dbContext.UserProfiles.FirstOrDefaultAsync(x => x.Id == request.AuthorId, cancellationToken);
        if (author is null)
        {
            throw new InvalidOperationException("Comment author does not exist.");
        }

        var content = NormalizeCommentContent(request.Content);

        if (request.ParentCommentId.HasValue)
        {
            var parentExists = post.Comments.Any(x => x.Id == request.ParentCommentId.Value);
            if (!parentExists)
            {
                throw new InvalidOperationException("Reply target comment does not exist on this post.");
            }
        }

        var comment = new CommunityPostComment
        {
            Id = Guid.NewGuid(),
            PostId = postId,
            ParentCommentId = request.ParentCommentId,
            AuthorId = request.AuthorId,
            Content = content,
            CreatedAtUtc = DateTime.UtcNow,
            Author = author
        };

        dbContext.CommunityPostComments.Add(comment);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapPost(post, request.AuthorId);
    }

    public async Task<CommunityPostDto?> UpdateCommentAsync(Guid communityId, Guid postId, Guid commentId, UpdateCommunityPostCommentRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.SavedBy)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var comment = post.Comments.FirstOrDefault(x => x.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        if (comment.AuthorId != request.ActorId)
        {
            throw new UnauthorizedAccessException("You can only edit your own comments.");
        }

        comment.Content = NormalizeCommentContent(request.Content);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapPost(post, request.ActorId);
    }

    public async Task<CommunityPostDto?> DeleteCommentAsync(Guid communityId, Guid postId, Guid commentId, Guid actorId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.SavedBy)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var comment = post.Comments.FirstOrDefault(x => x.Id == commentId);
        if (comment is null)
        {
            return null;
        }

        if (comment.AuthorId != actorId)
        {
            throw new UnauthorizedAccessException("You can only delete your own comments.");
        }

        dbContext.CommunityPostComments.Remove(comment);
        post.Comments.Remove(comment);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapPost(post, actorId);
    }

    public async Task<CommunityPostDto?> UpdatePostAsync(Guid communityId, Guid postId, UpdateCommunityPostRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.SavedBy)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        if (post.AuthorId != request.ActorId)
        {
            throw new UnauthorizedAccessException("You can only edit your own posts.");
        }

        var title = NormalizePostTitle(request.Title);
        var content = NormalizePostContent(request.Content);
        var linkUrl = NormalizeLinkUrl(request.LinkUrl);
        var pollQuestion = NormalizePollQuestion(request.PollQuestion);
        var pollOptions = NormalizePollOptions(request.PollOptions);

        post.Title = title;
        post.Content = content;
        post.LinkUrl = linkUrl;

        if (request.ImageUrls is not null)
        {
            var imageUrls = NormalizePostImageUrls(request.ImageUrls);

            // Detach tracked image rows first so SaveChanges does not try to persist stale entries
            // that were already removed by ExecuteDeleteAsync.
            foreach (var existingImage in post.Images.ToArray())
            {
                dbContext.Entry(existingImage).State = EntityState.Detached;
            }

            post.Images.Clear();

            await dbContext.CommunityPostImages
                .Where(x => x.PostId == post.Id)
                .ExecuteDeleteAsync(cancellationToken);

            var updatedImages = new List<CommunityPostImage>();
            foreach (var (url, index) in imageUrls.Select((value, i) => (value, i)))
            {
                updatedImages.Add(new CommunityPostImage
                {
                    Id = Guid.NewGuid(),
                    PostId = post.Id,
                    Url = url,
                    SortOrder = index
                });
            }

            if (updatedImages.Count > 0)
            {
                await dbContext.CommunityPostImages.AddRangeAsync(updatedImages, cancellationToken);
            }

            post.Images = updatedImages;
        }

        if (!string.IsNullOrWhiteSpace(pollQuestion))
        {
            if (post.Poll is null)
            {
                if (pollOptions.Count < 2)
                {
                    throw new ArgumentException("Polls require at least two options.", nameof(request));
                }

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
            else
            {
                var hasVotes = post.Poll.Options.SelectMany(x => x.Votes).Any();
                if (hasVotes)
                {
                    throw new ArgumentException("Poll cannot be edited after voting has started.", nameof(request));
                }

                if (pollOptions.Count < 2)
                {
                    throw new ArgumentException("Polls require at least two options.", nameof(request));
                }

                post.Poll.Question = pollQuestion;
                post.Poll.Options.Clear();
                foreach (var option in pollOptions)
                {
                    post.Poll.Options.Add(new CommunityPollOption
                    {
                        Id = Guid.NewGuid(),
                        PollId = post.Poll.Id,
                        Text = option
                    });
                }
            }
        }
        else if (request.ClearPoll && post.Poll is not null)
        {
            var hasVotes = post.Poll.Options.SelectMany(x => x.Votes).Any();
            if (hasVotes)
            {
                throw new ArgumentException("Poll cannot be removed after voting has started.", nameof(request));
            }

            post.Poll.Options.Clear();
            post.Poll = null;
        }

        var hasPoll = post.Poll is not null;
        var hasImages = request.ImageUrls is not null
            ? post.Images.Count > 0
            : post.Images.Any(x => !string.IsNullOrWhiteSpace(x.Url));

        if (string.IsNullOrWhiteSpace(post.Title)
            && string.IsNullOrWhiteSpace(post.Content)
            && string.IsNullOrWhiteSpace(post.LinkUrl)
            && !hasImages
            && !hasPoll)
        {
            throw new ArgumentException("Post title, content, link, image, or poll is required.", nameof(request));
        }

        post.ImageUrl = post.Images
            .OrderBy(x => x.SortOrder)
            .Select(x => x.Url)
            .FirstOrDefault(url => !string.IsNullOrWhiteSpace(url));

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapPost(post, request.ActorId);
    }

    public async Task<CommunityPostDto?> VotePostAsync(Guid communityId, Guid postId, VoteCommunityPostRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.SavedBy)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var isMember = post.Community.Members.Any(x => x.ProfileId == request.VoterId);
        if (!isMember)
        {
            throw new UnauthorizedAccessException("Join the community before voting.");
        }

        var normalizedVoteType = NormalizeVoteType(request.VoteType);
        var existingVote = post.Votes.FirstOrDefault(x => x.ProfileId == request.VoterId);

        if (normalizedVoteType is null)
        {
            if (existingVote is not null)
            {
                post.Votes.Remove(existingVote);
                dbContext.CommunityPostVotes.Remove(existingVote);
            }
        }
        else if (existingVote is null)
        {
            post.Votes.Add(new CommunityPostVote
            {
                PostId = post.Id,
                ProfileId = request.VoterId,
                Type = normalizedVoteType,
                CreatedAtUtc = DateTime.UtcNow
            });
        }
        else if (string.Equals(existingVote.Type, normalizedVoteType, StringComparison.OrdinalIgnoreCase))
        {
            post.Votes.Remove(existingVote);
            dbContext.CommunityPostVotes.Remove(existingVote);
        }
        else
        {
            existingVote.Type = normalizedVoteType;
            existingVote.CreatedAtUtc = DateTime.UtcNow;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return MapPost(post, request.VoterId);
    }

    public async Task<CommunityPostDto?> GetPostByIdAsync(Guid postId, Guid? viewerProfileId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .AsNoTracking()
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.SavedBy)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
            .Include(x => x.Poll)
                .ThenInclude(x => x.Options)
                    .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == postId, cancellationToken);

        if (post is null)
        {
            return null;
        }

        var isMember = viewerProfileId.HasValue && post.Community.Members.Any(x => x.ProfileId == viewerProfileId.Value);
        if (post.Community.IsPrivate && !isMember)
        {
            return null;
        }

        return MapPost(post, viewerProfileId);
    }

    public async Task<bool> DeletePostAsync(Guid communityId, Guid postId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .FirstOrDefaultAsync(x => x.Id == postId && x.CommunityId == communityId, cancellationToken);

        if (post is null)
        {
            return false;
        }

        var isPostOwner = post.AuthorId == profileId;
        var membership = post.Community.Members.FirstOrDefault(x => x.ProfileId == profileId);
        var isCommunityManager = membership is not null
            && CanModerateCommunityContent(membership.Role);

        if (!isPostOwner && !isCommunityManager)
        {
            throw new UnauthorizedAccessException("You can only delete your own posts or posts in communities you manage.");
        }

        if (!isPostOwner)
        {
            dbContext.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                RecipientId = post.AuthorId,
                ActorId = profileId,
                Type = "CommunityPostDeleted",
                Message = $"Your community post was removed by /{post.Community.Slug} moderators.",
                ReferenceId = post.Id.ToString(),
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        dbContext.CommunityPosts.Remove(post);
        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        return true;
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
        var normalizedQuery = DiscoverySearchBackend.NormalizeQuery(query);
        var expandedTerms = DiscoverySearchBackend.ExpandTerms(normalizedQuery);
        var candidateTake = Math.Clamp(normalizedTake * 4, normalizedTake, 320);

        var cacheKey = $"community:posts:v3:cv={SearchCacheVersionStamp.CommunityVersion}:community={communityId}:viewer={viewerProfileId?.ToString() ?? "anon"}:q={normalizedQuery ?? string.Empty}:take={normalizedTake}";
        return await SearchResultCache.GetOrCreateAsync(memoryCache, cacheKey, SearchCacheTtl, async () =>
        {
            var postsQuery = dbContext.CommunityPosts
                .AsNoTracking()
                .Where(x => x.CommunityId == communityId)
                .Include(x => x.Author)
                .Include(x => x.Images)
                .Include(x => x.SavedBy)
                .Include(x => x.Comments)
                    .ThenInclude(x => x.Author)
                .Include(x => x.Votes)
                .Include(x => x.Poll)
                    .ThenInclude(x => x.Options)
                        .ThenInclude(x => x.Votes)
                .AsQueryable();

            var candidates = await postsQuery
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(candidateTake)
                .ToArrayAsync(cancellationToken);

            var posts = expandedTerms.Count > 0
                ? candidates
                    .Select(post => new
                    {
                        Post = post,
                        Score = DiscoverySearchBackend.ScoreFields(expandedTerms,
                            (post.Title, 1.0),
                            (post.Content, 1.0),
                            (post.LinkUrl, 0.8),
                            (post.Author.Handle, 0.8),
                            (post.Poll?.Question, 0.9),
                            (string.Join(' ', post.Poll?.Options.Select(option => option.Text) ?? []), 0.7))
                            + Math.Min(post.Votes.Count(vote => string.Equals(vote.Type, UpvoteType, StringComparison.OrdinalIgnoreCase)), 500) / 12d
                            + (post.Comments.Count * 2d)
                    })
                    .Where(x => x.Score > 0)
                    .OrderByDescending(x => x.Score)
                    .ThenByDescending(x => x.Post.CreatedAtUtc)
                    .Take(normalizedTake)
                    .Select(x => x.Post)
                    .ToArray()
                : candidates.Take(normalizedTake).ToArray();

            return posts
                .Select(post => MapPost(post, viewerProfileId))
                .ToArray();
        });
    }

    public async Task<IReadOnlyCollection<CommunityPostDto>> SearchPostsAsync(Guid? viewerProfileId, string? query = null, int take = 50, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var normalizedTake = Math.Clamp(take, 1, 100);
        var normalizedQuery = DiscoverySearchBackend.NormalizeQuery(query);
        var expandedTerms = DiscoverySearchBackend.ExpandTerms(normalizedQuery);
        var candidateTake = Math.Clamp(normalizedTake * 4, normalizedTake, 320);

        if (expandedTerms.Count == 0)
        {
            return Array.Empty<CommunityPostDto>();
        }

        var viewerId = viewerProfileId.GetValueOrDefault();

        var cacheKey = $"community:search-posts:v3:cv={SearchCacheVersionStamp.CommunityVersion}:viewer={viewerProfileId?.ToString() ?? "anon"}:q={normalizedQuery ?? string.Empty}:take={normalizedTake}";
        return await SearchResultCache.GetOrCreateAsync(memoryCache, cacheKey, SearchCacheTtl, async () =>
        {
            var candidates = await dbContext.CommunityPosts
                .AsNoTracking()
                .Where(x => !x.Community.IsPrivate || (viewerProfileId.HasValue && x.Community.Members.Any(member => member.ProfileId == viewerId)))
                .Include(x => x.Community)
                .Include(x => x.Author)
                .Include(x => x.Images)
                .Include(x => x.SavedBy)
                .Include(x => x.Comments)
                    .ThenInclude(x => x.Author)
                .Include(x => x.Votes)
                .Include(x => x.Poll)
                    .ThenInclude(x => x.Options)
                        .ThenInclude(x => x.Votes)
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(candidateTake)
                .ToArrayAsync(cancellationToken);

            var posts = candidates
                .Select(post => new
                {
                    Post = post,
                    Score = DiscoverySearchBackend.ScoreFields(expandedTerms,
                        (post.Title, 1.0),
                        (post.Content, 1.0),
                        (post.LinkUrl, 0.8),
                        (post.Author.Handle, 0.8),
                        (post.Community?.Name, 0.8),
                        (post.Community?.Slug, 0.8),
                        (post.Poll?.Question, 0.9),
                        (string.Join(' ', post.Poll?.Options.Select(option => option.Text) ?? []), 0.7))
                        + Math.Min(post.Votes.Count(vote => string.Equals(vote.Type, UpvoteType, StringComparison.OrdinalIgnoreCase)), 500) / 12d
                        + (post.Comments.Count * 2d)
                })
                .Where(x => x.Score > 0)
                .OrderByDescending(x => x.Score)
                .ThenByDescending(x => x.Post.CreatedAtUtc)
                .Take(normalizedTake)
                .Select(x => x.Post)
                .ToArray();

            return posts.Select(post => MapPost(post, viewerProfileId)).ToArray();
        });
    }

    public async Task<CommunityPostDto?> SavePostAsync(Guid communityId, Guid postId, Guid profileId, CancellationToken cancellationToken = default)
    {
        await EnsureCommunitySchemaAsync(cancellationToken);

        var post = await dbContext.CommunityPosts
            .Include(x => x.Community)
                .ThenInclude(x => x.Members)
            .Include(x => x.Author)
            .Include(x => x.Images)
            .Include(x => x.SavedBy)
            .Include(x => x.Comments)
                .ThenInclude(x => x.Author)
            .Include(x => x.Votes)
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
            SearchCacheVersionStamp.BumpCommunity();
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
        SearchCacheVersionStamp.BumpCommunity();
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

        if (existingVote is not null)
        {
            dbContext.CommunityPollVotes.Remove(existingVote);

            // Clicking the same option toggles the vote off.
            if (existingVote.OptionId == selectedOption.Id)
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                SearchCacheVersionStamp.BumpCommunity();
                var refreshedPollAfterRemove = await dbContext.CommunityPolls
                    .AsNoTracking()
                    .Include(x => x.Options)
                        .ThenInclude(x => x.Votes)
                    .FirstOrDefaultAsync(x => x.Id == pollId, cancellationToken);

                return refreshedPollAfterRemove is null ? null : MapPoll(refreshedPollAfterRemove, request.VoterId);
            }
        }

        selectedOption.Votes.Add(new CommunityPollVote
        {
            OptionId = selectedOption.Id,
            VoterId = request.VoterId,
            CreatedAtUtc = DateTime.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
        SearchCacheVersionStamp.BumpCommunity();
        var refreshedPoll = await dbContext.CommunityPolls
            .AsNoTracking()
            .Include(x => x.Options)
                .ThenInclude(x => x.Votes)
            .FirstOrDefaultAsync(x => x.Id == pollId, cancellationToken);

        return refreshedPoll is null ? null : MapPoll(refreshedPoll, request.VoterId);
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

    private static string? NormalizePostTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        var normalized = title.Trim();
        if (normalized.Length > 220)
        {
            throw new ArgumentException("Post title cannot exceed 220 characters.", nameof(title));
        }

        return normalized;
    }

    private static string? NormalizeLinkUrl(string? linkUrl)
    {
        if (string.IsNullOrWhiteSpace(linkUrl))
        {
            return null;
        }

        var normalized = linkUrl.Trim();
        if (normalized.Length > 2048)
        {
            throw new ArgumentException("Link url cannot exceed 2048 characters.", nameof(linkUrl));
        }

        if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("Link url must be a valid http or https URL.", nameof(linkUrl));
        }

        return normalized;
    }

    private static IReadOnlyCollection<string> NormalizePostImageUrls(IReadOnlyCollection<string>? imageUrls)
    {
        if (imageUrls is null)
        {
            return Array.Empty<string>();
        }

        return imageUrls
            .Select(url => NormalizeImageUrl(url))
            .Where(url => !string.IsNullOrWhiteSpace(url))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .Cast<string>()
            .ToArray();
    }

    private static string NormalizeCommentContent(string? content)
    {
        var normalized = content?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Comment content is required.", nameof(content));
        }

        if (normalized.Length > MaxCommunityCommentLength)
        {
            throw new ArgumentException($"Comment content cannot exceed {MaxCommunityCommentLength} characters.", nameof(content));
        }

        return normalized;
    }

    private static string? NormalizeVoteType(string? voteType)
    {
        if (string.IsNullOrWhiteSpace(voteType))
        {
            return null;
        }

        var normalized = voteType.Trim();
        if (string.Equals(normalized, UpvoteType, StringComparison.OrdinalIgnoreCase))
        {
            return UpvoteType;
        }

        if (string.Equals(normalized, DownvoteType, StringComparison.OrdinalIgnoreCase))
        {
            return DownvoteType;
        }

        throw new ArgumentException("Vote type must be 'Upvote' or 'Downvote'.", nameof(voteType));
    }

    private static string NormalizeManageableMemberRole(string? role)
    {
        var normalized = role?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Role is required.", nameof(role));
        }

        if (string.Equals(normalized, MemberRole, StringComparison.OrdinalIgnoreCase))
        {
            return MemberRole;
        }

        if (string.Equals(normalized, ModeratorRole, StringComparison.OrdinalIgnoreCase))
        {
            return ModeratorRole;
        }

        throw new ArgumentException("Role must be 'Member' or 'Moderator'.", nameof(role));
    }

    private static bool CanManageCommunity(string? role)
    {
        return string.Equals(role, OwnerRole, StringComparison.Ordinal)
            || string.Equals(role, AdminRole, StringComparison.Ordinal);
    }

    private static bool CanModerateCommunityContent(string? role)
    {
        return string.Equals(role, OwnerRole, StringComparison.Ordinal)
            || string.Equals(role, AdminRole, StringComparison.Ordinal)
            || string.Equals(role, ModeratorRole, StringComparison.Ordinal);
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
                    member.JoinedAtUtc,
                    member.MutedUntilUtc))
                .ToArray();
        }

        return new CommunityDto(
            community.Id,
            community.Slug,
            community.Name,
            community.Description,
            ParseCommunityRules(community.RulesJson),
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
        var upvoteCount = post.Votes.Count(x => string.Equals(x.Type, UpvoteType, StringComparison.OrdinalIgnoreCase));
        var downvoteCount = post.Votes.Count(x => string.Equals(x.Type, DownvoteType, StringComparison.OrdinalIgnoreCase));
        var myVoteType = viewerProfileId.HasValue
            ? post.Votes.FirstOrDefault(x => x.ProfileId == viewerProfileId.Value)?.Type
            : null;
        var comments = post.Comments
            .OrderBy(x => x.CreatedAtUtc)
            .Select(comment => new CommunityPostCommentDto(
                comment.Id,
                comment.PostId,
                comment.ParentCommentId,
                comment.AuthorId,
                comment.Author.Handle,
                comment.Author.ImageUrl,
                comment.Content,
                comment.CreatedAtUtc))
            .ToArray();
        var imageUrls = post.Images
            .OrderBy(x => x.SortOrder)
            .Select(x => x.Url)
            .Where(url => !string.IsNullOrWhiteSpace(url))
            .ToArray();
        var primaryImageUrl = imageUrls.FirstOrDefault() ?? post.ImageUrl;

        return new CommunityPostDto(
            post.Id,
            post.CommunityId,
            post.AuthorId,
            post.Author.Handle,
            post.Author.ImageUrl,
            post.Title,
            post.LinkUrl,
            post.Content,
            primaryImageUrl,
            imageUrls,
            post.CreatedAtUtc,
            upvoteCount,
            downvoteCount,
            myVoteType,
            isSavedByMe,
                post.Poll is null ? null : MapPoll(post.Poll, viewerProfileId),
                comments);
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
        if (communitySchemaInitialized)
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

            if (dbContext.Database.IsSqlite())
            {
                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS Communities (
                    Id TEXT NOT NULL PRIMARY KEY,
                    CreatedByProfileId TEXT NOT NULL,
                    Slug TEXT NOT NULL,
                    Name TEXT NOT NULL,
                    Description TEXT NULL,
                    RulesJson TEXT NULL,
                    ImageUrl TEXT NULL,
                    IsPrivate INTEGER NOT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    FOREIGN KEY (CreatedByProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
                );
                """, cancellationToken);

                try
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE Communities ADD COLUMN RulesJson TEXT NULL;", cancellationToken);
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
                {
                }

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
                    MutedUntilUtc TEXT NULL,
                    PRIMARY KEY (CommunityId, ProfileId),
                    FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                    FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
                );
                """, cancellationToken);

                try
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE CommunityMembers ADD COLUMN MutedUntilUtc TEXT NULL;", cancellationToken);
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
                {
                }

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityMembers_ProfileId ON CommunityMembers (ProfileId);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityMembers_CommunityId_Role ON CommunityMembers (CommunityId, Role);", cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS CommunityPosts (
                    Id TEXT NOT NULL PRIMARY KEY,
                    CommunityId TEXT NOT NULL,
                    AuthorId TEXT NOT NULL,
                    Title TEXT NULL,
                    LinkUrl TEXT NULL,
                    Content TEXT NULL,
                    ImageUrl TEXT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                    FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
                );
                """, cancellationToken);

                try
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE CommunityPosts ADD COLUMN Title TEXT NULL;", cancellationToken);
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
                {
                }

                try
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE CommunityPosts ADD COLUMN LinkUrl TEXT NULL;", cancellationToken);
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
                {
                }

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPosts_CommunityId_CreatedAtUtc ON CommunityPosts (CommunityId, CreatedAtUtc);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPosts_AuthorId ON CommunityPosts (AuthorId);", cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS CommunityPostImages (
                    Id TEXT NOT NULL PRIMARY KEY,
                    PostId TEXT NOT NULL,
                    Url TEXT NOT NULL,
                    SortOrder INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPostImages_PostId_SortOrder ON CommunityPostImages (PostId, SortOrder);", cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS CommunityPostComments (
                    Id TEXT NOT NULL PRIMARY KEY,
                    PostId TEXT NOT NULL,
                    ParentCommentId TEXT NULL,
                    AuthorId TEXT NOT NULL,
                    Content TEXT NOT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE,
                    FOREIGN KEY (ParentCommentId) REFERENCES CommunityPostComments (Id) ON DELETE RESTRICT,
                    FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
                );
                """, cancellationToken);

                try
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE CommunityPostComments ADD COLUMN ParentCommentId TEXT NULL;", cancellationToken);
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
                {
                }

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPostComments_PostId_CreatedAtUtc ON CommunityPostComments (PostId, CreatedAtUtc);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPostComments_AuthorId ON CommunityPostComments (AuthorId);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPostComments_ParentCommentId ON CommunityPostComments (ParentCommentId);", cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS CommunityPostVotes (
                    PostId TEXT NOT NULL,
                    ProfileId TEXT NOT NULL,
                    Type TEXT NOT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    PRIMARY KEY (PostId, ProfileId),
                    FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE,
                    FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPostVotes_PostId_Type ON CommunityPostVotes (PostId, Type);", cancellationToken);
                await dbContext.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_CommunityPostVotes_ProfileId ON CommunityPostVotes (ProfileId);", cancellationToken);

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
            }
            else if (dbContext.Database.IsMySql())
            {
                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `Communities` (
                    `Id` char(36) NOT NULL,
                    `CreatedByProfileId` char(36) NOT NULL,
                    `Slug` varchar(60) NOT NULL,
                    `Name` varchar(120) NOT NULL,
                    `Description` varchar(600) NULL,
                    `RulesJson` longtext NULL,
                    `ImageUrl` varchar(1024) NULL,
                    `IsPrivate` tinyint(1) NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`Id`),
                    UNIQUE KEY `IX_Communities_Slug` (`Slug`),
                    KEY `IX_Communities_CreatedAtUtc` (`CreatedAtUtc`)
                );
                """, cancellationToken);

                var communityImageColumnExists = await dbContext.Database
                    .SqlQueryRaw<int>("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Communities' AND COLUMN_NAME = 'ImageUrl' LIMIT 1")
                    .AnyAsync(cancellationToken);

                if (!communityImageColumnExists)
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE `Communities` ADD COLUMN `ImageUrl` varchar(1024) NULL;", cancellationToken);
                }

                var communityRulesColumnExists = await dbContext.Database
                    .SqlQueryRaw<int>("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Communities' AND COLUMN_NAME = 'RulesJson' LIMIT 1")
                    .AnyAsync(cancellationToken);

                if (!communityRulesColumnExists)
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE `Communities` ADD COLUMN `RulesJson` longtext NULL;", cancellationToken);
                }

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityMembers` (
                    `CommunityId` char(36) NOT NULL,
                    `ProfileId` char(36) NOT NULL,
                    `Role` varchar(24) NOT NULL,
                    `JoinedAtUtc` datetime(6) NOT NULL,
                    `MutedUntilUtc` datetime(6) NULL,
                    PRIMARY KEY (`CommunityId`, `ProfileId`),
                    KEY `IX_CommunityMembers_ProfileId` (`ProfileId`),
                    KEY `IX_CommunityMembers_CommunityId_Role` (`CommunityId`, `Role`)
                );
                """, cancellationToken);

                var memberMutedUntilColumnExists = await dbContext.Database
                    .SqlQueryRaw<int>("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CommunityMembers' AND COLUMN_NAME = 'MutedUntilUtc' LIMIT 1")
                    .AnyAsync(cancellationToken);

                if (!memberMutedUntilColumnExists)
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE `CommunityMembers` ADD COLUMN `MutedUntilUtc` datetime(6) NULL;", cancellationToken);
                }

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityPosts` (
                    `Id` char(36) NOT NULL,
                    `CommunityId` char(36) NOT NULL,
                    `AuthorId` char(36) NOT NULL,
                    `Title` varchar(220) NULL,
                    `LinkUrl` varchar(2048) NULL,
                    `Content` varchar(5000) NULL,
                    `ImageUrl` varchar(1024) NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`Id`),
                    KEY `IX_CommunityPosts_CommunityId_CreatedAtUtc` (`CommunityId`, `CreatedAtUtc`),
                    KEY `IX_CommunityPosts_AuthorId` (`AuthorId`)
                );
                """, cancellationToken);

                var postTitleColumnExists = await dbContext.Database
                    .SqlQueryRaw<int>("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CommunityPosts' AND COLUMN_NAME = 'Title' LIMIT 1")
                    .AnyAsync(cancellationToken);

                if (!postTitleColumnExists)
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE `CommunityPosts` ADD COLUMN `Title` varchar(220) NULL;", cancellationToken);
                }

                var postLinkUrlColumnExists = await dbContext.Database
                    .SqlQueryRaw<int>("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CommunityPosts' AND COLUMN_NAME = 'LinkUrl' LIMIT 1")
                    .AnyAsync(cancellationToken);

                if (!postLinkUrlColumnExists)
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE `CommunityPosts` ADD COLUMN `LinkUrl` varchar(2048) NULL;", cancellationToken);
                }

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityPostImages` (
                    `Id` char(36) NOT NULL,
                    `PostId` char(36) NOT NULL,
                    `Url` varchar(1024) NOT NULL,
                    `SortOrder` int NOT NULL DEFAULT 0,
                    PRIMARY KEY (`Id`),
                    KEY `IX_CommunityPostImages_PostId_SortOrder` (`PostId`, `SortOrder`)
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityPostComments` (
                    `Id` char(36) NOT NULL,
                    `PostId` char(36) NOT NULL,
                    `ParentCommentId` char(36) NULL,
                    `AuthorId` char(36) NOT NULL,
                    `Content` varchar(500) NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`Id`),
                    KEY `IX_CommunityPostComments_PostId_CreatedAtUtc` (`PostId`, `CreatedAtUtc`),
                    KEY `IX_CommunityPostComments_AuthorId` (`AuthorId`),
                    KEY `IX_CommunityPostComments_ParentCommentId` (`ParentCommentId`)
                );
                """, cancellationToken);

                var commentParentColumnExists = await dbContext.Database
                    .SqlQueryRaw<int>("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CommunityPostComments' AND COLUMN_NAME = 'ParentCommentId' LIMIT 1")
                    .AnyAsync(cancellationToken);

                if (!commentParentColumnExists)
                {
                    await dbContext.Database.ExecuteSqlRawAsync("ALTER TABLE `CommunityPostComments` ADD COLUMN `ParentCommentId` char(36) NULL;", cancellationToken);
                }


                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityPostVotes` (
                    `PostId` char(36) NOT NULL,
                    `ProfileId` char(36) NOT NULL,
                    `Type` varchar(16) NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`PostId`, `ProfileId`),
                    KEY `IX_CommunityPostVotes_PostId_Type` (`PostId`, `Type`),
                    KEY `IX_CommunityPostVotes_ProfileId` (`ProfileId`)
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityPolls` (
                    `Id` char(36) NOT NULL,
                    `PostId` char(36) NOT NULL,
                    `Question` varchar(280) NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`Id`),
                    UNIQUE KEY `IX_CommunityPolls_PostId` (`PostId`)
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityPollOptions` (
                    `Id` char(36) NOT NULL,
                    `PollId` char(36) NOT NULL,
                    `Text` varchar(160) NOT NULL,
                    PRIMARY KEY (`Id`),
                    KEY `IX_CommunityPollOptions_PollId` (`PollId`)
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunityPollVotes` (
                    `OptionId` char(36) NOT NULL,
                    `VoterId` char(36) NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`OptionId`, `VoterId`),
                    KEY `IX_CommunityPollVotes_VoterId` (`VoterId`)
                );
                """, cancellationToken);

                await dbContext.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS `CommunitySavedPosts` (
                    `PostId` char(36) NOT NULL,
                    `ProfileId` char(36) NOT NULL,
                    `SavedAtUtc` datetime(6) NOT NULL,
                    PRIMARY KEY (`PostId`, `ProfileId`),
                    KEY `IX_CommunitySavedPosts_ProfileId` (`ProfileId`),
                    KEY `IX_CommunitySavedPosts_ProfileId_SavedAtUtc` (`ProfileId`, `SavedAtUtc`)
                );
                """, cancellationToken);
            }

            communitySchemaInitialized = true;
        }
        finally
        {
            SchemaInitLock.Release();
        }
    }

    private static IReadOnlyCollection<CommunityRuleDto> NormalizeCommunityRules(IReadOnlyCollection<CommunityRuleDto>? rules)
    {
        if (rules is null || rules.Count == 0)
        {
            return Array.Empty<CommunityRuleDto>();
        }

        var normalizedRules = new List<CommunityRuleDto>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rule in rules)
        {
            var text = rule.Text?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            if (text.Length > 220)
            {
                text = text[..220].Trim();
            }

            var description = string.IsNullOrWhiteSpace(rule.Description)
                ? null
                : rule.Description.Trim();

            if (!string.IsNullOrEmpty(description) && description.Length > 1200)
            {
                description = description[..1200].Trim();
            }

            var key = $"{text}|{description}";
            if (!seen.Add(key))
            {
                continue;
            }

            normalizedRules.Add(new CommunityRuleDto(text, description));
            if (normalizedRules.Count >= 20)
            {
                break;
            }
        }

        return normalizedRules;
    }

    private static IReadOnlyCollection<CommunityRuleDto> NormalizeLegacyCommunityRules(IReadOnlyCollection<string>? rules)
    {
        if (rules is null || rules.Count == 0)
        {
            return Array.Empty<CommunityRuleDto>();
        }

        return rules
            .Select(rule => rule?.Trim() ?? string.Empty)
            .Where(rule => !string.IsNullOrWhiteSpace(rule))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(20)
            .Select(rule => rule.Length > 220 ? rule[..220].Trim() : rule)
            .Where(rule => !string.IsNullOrWhiteSpace(rule))
            .Select(rule => new CommunityRuleDto(rule, null))
            .ToArray();
    }

    private static string? SerializeCommunityRules(IReadOnlyCollection<CommunityRuleDto> rules)
    {
        if (rules.Count == 0)
        {
            return null;
        }

        return JsonSerializer.Serialize(rules);
    }

    private static IReadOnlyCollection<CommunityRuleDto> ParseCommunityRules(string? rulesJson)
    {
        if (string.IsNullOrWhiteSpace(rulesJson))
        {
            return Array.Empty<CommunityRuleDto>();
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<List<CommunityRuleDto>>(rulesJson);
            return NormalizeCommunityRules(parsed);
        }
        catch
        {
            try
            {
                var legacyParsed = JsonSerializer.Deserialize<List<string>>(rulesJson);
                return NormalizeLegacyCommunityRules(legacyParsed);
            }
            catch
            {
                return Array.Empty<CommunityRuleDto>();
            }
        }
    }

    private static bool IsMemberTimedOut(CommunityMember member)
    {
        return member.MutedUntilUtc.HasValue && member.MutedUntilUtc.Value > DateTime.UtcNow;
    }

    private static int NormalizeTimeoutDurationDays(int durationDays)
    {
        if (AllowedTimeoutDays.Contains(durationDays))
        {
            return durationDays;
        }

        throw new ArgumentException("Timeout duration must be one of: 1, 7, or 30 days.", nameof(durationDays));
    }
}
