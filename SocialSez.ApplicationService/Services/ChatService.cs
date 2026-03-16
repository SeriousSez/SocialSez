using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class ChatService(SocialSezContext dbContext) : IChatService
{
    private static readonly HashSet<string> AllowedReactionTypes = new(StringComparer.Ordinal)
    {
        "Like", "Love", "Laugh", "Wow", "Sad", "Angry", "PartyHorn", "Clap", "Fire", "Party"
    };

    public async Task<bool> IsConversationMemberAsync(Guid profileId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        return await IsMemberAsync(profileId, conversationId, cancellationToken);
    }

    public async Task<IReadOnlyCollection<ChatConversationDto>> GetConversationsAsync(Guid profileId, CancellationToken cancellationToken = default)
    {
        var conversations = await dbContext.ChatConversations
            .AsNoTracking()
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .Where(x => x.Members.Any(m => m.ProfileId == profileId))
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var conversationIds = conversations.Select(x => x.Id).ToArray();
        var latestMessages = await dbContext.ChatMessages
            .AsNoTracking()
            .Include(x => x.AuthorProfile)
            .Where(x => conversationIds.Contains(x.ConversationId))
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var latestByConversation = latestMessages
            .GroupBy(x => x.ConversationId)
            .ToDictionary(g => g.Key, g => g.First());

        return conversations
            .Select(x => MapConversationDto(x, profileId, latestByConversation.TryGetValue(x.Id, out var latest) ? latest : null))
            .OrderByDescending(x => x.LastMessage?.CreatedAtUtc ?? x.CreatedAtUtc)
            .ToArray();
    }

    public async Task<ChatConversationDto> CreateOrGetDirectConversationAsync(Guid profileId, CreateDirectConversationRequest request, CancellationToken cancellationToken = default)
    {
        if (request.OtherProfileId == profileId)
        {
            throw new ArgumentException("You cannot create a direct conversation with yourself.", nameof(request));
        }

        if (await HasBlockedRelationshipAsync(profileId, request.OtherProfileId, cancellationToken))
        {
            throw new InvalidOperationException("You cannot message this user because one of you has blocked the other.");
        }

        var profileIds = new[] { profileId, request.OtherProfileId };
        var profiles = await dbContext.UserProfiles
            .AsNoTracking()
            .Where(x => profileIds.Contains(x.Id))
            .Select(x => new { x.Id, x.Handle, x.IsPrivate })
            .ToListAsync(cancellationToken);

        if (profiles.Count != 2)
        {
            throw new InvalidOperationException("One or more profiles do not exist.");
        }

        var requester = profiles.First(x => x.Id == profileId);
        var target = profiles.First(x => x.Id == request.OtherProfileId);

        var requesterFollowsTarget = await dbContext.Follows
            .AsNoTracking()
            .AnyAsync(x => x.FollowerId == profileId && x.FollowedId == request.OtherProfileId, cancellationToken);

        var hasAcceptedMessageRequestHistory = await dbContext.ChatConversations
            .AsNoTracking()
            .Where(x => !x.IsGroup
                && x.Members.Any(m => m.ProfileId == profileId)
                && x.Members.Any(m => m.ProfileId == request.OtherProfileId))
            .AnyAsync(x => x.Messages.Any(message => message.AuthorProfileId == request.OtherProfileId), cancellationToken);

        var shouldCreateMessageRequestNotification = !requesterFollowsTarget && !hasAcceptedMessageRequestHistory;

        var directConversations = await dbContext.ChatConversations
            .AsNoTracking()
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .Where(x => !x.IsGroup && x.Members.Any(m => m.ProfileId == profileId))
            .ToListAsync(cancellationToken);

        var existing = directConversations.FirstOrDefault(x =>
            x.Members.Count == 2 &&
            x.Members.Any(m => m.ProfileId == profileId) &&
            x.Members.Any(m => m.ProfileId == request.OtherProfileId));

        if (existing is not null)
        {
            var lastMessage = await dbContext.ChatMessages
                .AsNoTracking()
                .Include(x => x.AuthorProfile)
                .Where(x => x.ConversationId == existing.Id)
                .OrderByDescending(x => x.CreatedAtUtc)
                .FirstOrDefaultAsync(cancellationToken);

            return MapConversationDto(existing, profileId, lastMessage);
        }

        var conversation = new ChatConversation
        {
            Id = Guid.NewGuid(),
            CreatedByProfileId = profileId,
            IsGroup = false,
            CreatedAtUtc = DateTime.UtcNow
        };

        conversation.Members.Add(new ChatConversationMember
        {
            ConversationId = conversation.Id,
            ProfileId = profileId,
            JoinedAtUtc = DateTime.UtcNow
        });

        conversation.Members.Add(new ChatConversationMember
        {
            ConversationId = conversation.Id,
            ProfileId = request.OtherProfileId,
            JoinedAtUtc = DateTime.UtcNow
        });

        dbContext.ChatConversations.Add(conversation);

        if (shouldCreateMessageRequestNotification)
        {
            dbContext.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                RecipientId = request.OtherProfileId,
                ActorId = profileId,
                Type = "MessageRequest",
                Message = $"@{requester.Handle} sent you a message request.",
                ReferenceId = conversation.Id.ToString(),
                IsRead = false,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        var created = await dbContext.ChatConversations
            .AsNoTracking()
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstAsync(x => x.Id == conversation.Id, cancellationToken);

        return MapConversationDto(created, profileId, null);
    }

    public async Task<ChatConversationDto> CreateGroupConversationAsync(Guid profileId, CreateGroupConversationRequest request, CancellationToken cancellationToken = default)
    {
        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            throw new ArgumentException("Group title is required.", nameof(request));
        }

        var memberIds = request.MemberProfileIds
            .Append(profileId)
            .Distinct()
            .ToArray();

        if (memberIds.Length < 3)
        {
            throw new ArgumentException("Group chats require at least three participants.", nameof(request));
        }

        var existingCount = await dbContext.UserProfiles.CountAsync(x => memberIds.Contains(x.Id), cancellationToken);
        if (existingCount != memberIds.Length)
        {
            throw new InvalidOperationException("One or more selected members do not exist.");
        }

        var otherMemberIds = memberIds
            .Where(id => id != profileId)
            .ToArray();

        var hasBlockedMember = otherMemberIds.Length > 0 && await dbContext.UserBlocks
            .AsNoTracking()
            .AnyAsync(x =>
                (x.BlockerId == profileId && otherMemberIds.Contains(x.BlockedId))
                || (x.BlockedId == profileId && otherMemberIds.Contains(x.BlockerId)),
                cancellationToken);

        if (hasBlockedMember)
        {
            throw new InvalidOperationException("You cannot create a group with users that are blocked.");
        }

        var conversationId = Guid.NewGuid();

        var conversation = new ChatConversation
        {
            Id = conversationId,
            CreatedByProfileId = profileId,
            IsGroup = true,
            Title = title,
            CreatedAtUtc = DateTime.UtcNow,
            Members = memberIds.Select(id => new ChatConversationMember
            {
                ConversationId = conversationId,
                ProfileId = id,
                JoinedAtUtc = DateTime.UtcNow
            }).ToList()
        };

        dbContext.ChatConversations.Add(conversation);
        await dbContext.SaveChangesAsync(cancellationToken);

        var created = await dbContext.ChatConversations
            .AsNoTracking()
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstAsync(x => x.Id == conversation.Id, cancellationToken);

        return MapConversationDto(created, profileId, null);
    }

    public async Task<ChatConversationDto?> UpdateGroupConversationTitleAsync(Guid profileId, Guid conversationId, UpdateGroupConversationTitleRequest request, CancellationToken cancellationToken = default)
    {
        var conversation = await dbContext.ChatConversations
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == conversationId, cancellationToken);

        if (conversation is null || !conversation.Members.Any(x => x.ProfileId == profileId))
        {
            return null;
        }

        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            throw new ArgumentException("Chat title is required.", nameof(request));
        }

        conversation.Title = title;
        await dbContext.SaveChangesAsync(cancellationToken);

        var lastMessage = await dbContext.ChatMessages
            .AsNoTracking()
            .Include(x => x.AuthorProfile)
            .Where(x => x.ConversationId == conversationId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        return MapConversationDto(conversation, profileId, lastMessage);
    }

    public async Task<bool> LeaveGroupConversationAsync(Guid profileId, Guid conversationId, CancellationToken cancellationToken = default)
    {
        var conversation = await dbContext.ChatConversations
            .Include(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == conversationId, cancellationToken);

        if (conversation is null)
        {
            return false;
        }

        var membership = conversation.Members.FirstOrDefault(x => x.ProfileId == profileId);
        if (membership is null)
        {
            return false;
        }

        dbContext.ChatConversationMembers.Remove(membership);

        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<ChatConversationDto?> SetConversationMuteAsync(Guid profileId, Guid conversationId, SetConversationMuteRequest request, CancellationToken cancellationToken = default)
    {
        var conversation = await dbContext.ChatConversations
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == conversationId, cancellationToken);

        if (conversation is null)
        {
            return null;
        }

        var membership = conversation.Members.FirstOrDefault(x => x.ProfileId == profileId);
        if (membership is null)
        {
            return null;
        }

        membership.IsMuted = request.IsMuted;
        await dbContext.SaveChangesAsync(cancellationToken);

        var lastMessage = await dbContext.ChatMessages
            .AsNoTracking()
            .Include(x => x.AuthorProfile)
            .Where(x => x.ConversationId == conversationId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        return MapConversationDto(conversation, profileId, lastMessage);
    }

    public async Task<IReadOnlyCollection<ChatMessageDto>?> GetMessagesAsync(Guid profileId, Guid conversationId, int take = 50, int skip = 0, CancellationToken cancellationToken = default)
    {
        if (!await IsMemberAsync(profileId, conversationId, cancellationToken))
        {
            return null;
        }

        var boundedTake = Math.Clamp(take, 1, 100);
        var boundedSkip = Math.Max(skip, 0);

        var messages = await dbContext.ChatMessages
            .AsNoTracking()
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
                .ThenInclude(x => x.Profile)
            .Where(x => x.ConversationId == conversationId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Skip(boundedSkip)
            .Take(boundedTake)
            .ToListAsync(cancellationToken);

        return messages
            .OrderBy(x => x.CreatedAtUtc)
            .Select(x => MapMessageDto(x, profileId))
            .ToArray();
    }

    public async Task<ChatMessageDto?> SendMessageAsync(Guid profileId, Guid conversationId, CreateChatMessageRequest request, CancellationToken cancellationToken = default)
    {
        var conversation = await dbContext.ChatConversations
            .AsNoTracking()
            .Include(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == conversationId, cancellationToken);

        if (conversation is null || !conversation.Members.Any(x => x.ProfileId == profileId))
        {
            return null;
        }

        if (!conversation.IsGroup)
        {
            var otherProfileId = conversation.Members
                .Where(x => x.ProfileId != profileId)
                .Select(x => x.ProfileId)
                .FirstOrDefault();

            if (otherProfileId != Guid.Empty && await HasBlockedRelationshipAsync(profileId, otherProfileId, cancellationToken))
            {
                throw new InvalidOperationException("You cannot send messages because one of you has blocked the other.");
            }
        }
        else
        {
            var otherProfileIds = conversation.Members
                .Where(x => x.ProfileId != profileId)
                .Select(x => x.ProfileId)
                .ToArray();

            if (otherProfileIds.Length > 0)
            {
                var hasBlockedParticipant = await dbContext.UserBlocks
                    .AsNoTracking()
                    .AnyAsync(x =>
                        (x.BlockerId == profileId && otherProfileIds.Contains(x.BlockedId))
                        || (x.BlockedId == profileId && otherProfileIds.Contains(x.BlockerId)),
                        cancellationToken);

                if (hasBlockedParticipant)
                {
                    throw new InvalidOperationException("You cannot send messages because one or more participants are in a blocked relationship with you.");
                }
            }
        }

        var content = request.Content?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException("Message content is required.", nameof(request));
        }

        var message = new ChatMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversationId,
            AuthorProfileId = profileId,
            Content = content,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.ChatMessages.Add(message);
        await dbContext.SaveChangesAsync(cancellationToken);

        return await HydrateMessageDtoAsync(message.Id, profileId, cancellationToken);
    }

    public async Task<ChatMessageDto?> UpdateMessageAsync(Guid profileId, Guid messageId, UpdateChatMessageRequest request, CancellationToken cancellationToken = default)
    {
        var message = await dbContext.ChatMessages
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
                .ThenInclude(x => x.Profile)
            .Include(x => x.Conversation)
                .ThenInclude(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == messageId, cancellationToken);

        if (message is null)
        {
            return null;
        }

        if (!message.Conversation.Members.Any(x => x.ProfileId == profileId))
        {
            return null;
        }

        if (message.AuthorProfileId != profileId)
        {
            return null;
        }

        var content = request.Content?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException("Message content is required.", nameof(request));
        }

        if (string.Equals(message.Content, content, StringComparison.Ordinal))
        {
            return await HydrateMessageDtoAsync(message.Id, profileId, cancellationToken);
        }

        message.Content = content;
        message.EditedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return await HydrateMessageDtoAsync(message.Id, profileId, cancellationToken);
    }

    public async Task<ChatMessageDto?> SetMessageReactionAsync(Guid profileId, Guid messageId, SetMessageReactionRequest request, CancellationToken cancellationToken = default)
    {
        var normalizedType = NormalizeReactionType(request.Type);
        if (!AllowedReactionTypes.Contains(normalizedType))
        {
            throw new ArgumentException("Unsupported reaction type.", nameof(request));
        }

        var message = await dbContext.ChatMessages
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
                .ThenInclude(x => x.Profile)
            .Include(x => x.Conversation)
                .ThenInclude(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == messageId, cancellationToken);

        if (message is null)
        {
            return null;
        }

        if (!message.Conversation.Members.Any(x => x.ProfileId == profileId))
        {
            return null;
        }

        var existingReaction = message.Reactions.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingReaction is null)
        {
            message.Reactions.Add(new ChatMessageReaction
            {
                MessageId = message.Id,
                ProfileId = profileId,
                Type = normalizedType,
                CreatedAtUtc = DateTime.UtcNow
            });
        }
        else
        {
            existingReaction.Type = normalizedType;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return await HydrateMessageDtoAsync(message.Id, profileId, cancellationToken);
    }

    public async Task<ChatMessageDto?> ClearMessageReactionAsync(Guid profileId, Guid messageId, CancellationToken cancellationToken = default)
    {
        var message = await dbContext.ChatMessages
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
                .ThenInclude(x => x.Profile)
            .Include(x => x.Conversation)
                .ThenInclude(x => x.Members)
            .FirstOrDefaultAsync(x => x.Id == messageId, cancellationToken);

        if (message is null)
        {
            return null;
        }

        if (!message.Conversation.Members.Any(x => x.ProfileId == profileId))
        {
            return null;
        }

        var existingReaction = message.Reactions.FirstOrDefault(x => x.ProfileId == profileId);
        if (existingReaction is not null)
        {
            dbContext.ChatMessageReactions.Remove(existingReaction);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return await HydrateMessageDtoAsync(message.Id, profileId, cancellationToken);
    }

    private async Task<bool> IsMemberAsync(Guid profileId, Guid conversationId, CancellationToken cancellationToken)
    {
        return await dbContext.ChatConversationMembers
            .AsNoTracking()
            .AnyAsync(x => x.ConversationId == conversationId && x.ProfileId == profileId, cancellationToken);
    }

    private async Task<bool> HasBlockedRelationshipAsync(Guid leftProfileId, Guid rightProfileId, CancellationToken cancellationToken)
    {
        return await dbContext.UserBlocks
            .AsNoTracking()
            .AnyAsync(x =>
                (x.BlockerId == leftProfileId && x.BlockedId == rightProfileId)
                || (x.BlockerId == rightProfileId && x.BlockedId == leftProfileId),
                cancellationToken);
    }

    private static string NormalizeReactionType(string value)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return string.Empty;
        }

        var normalizedToken = trimmed
            .Replace("-", string.Empty, StringComparison.Ordinal)
            .Replace("_", string.Empty, StringComparison.Ordinal)
            .Replace(" ", string.Empty, StringComparison.Ordinal)
            .ToLowerInvariant();

        return normalizedToken switch
        {
            "like" => "Like",
            "love" => "Love",
            "laugh" => "Laugh",
            "wow" => "Wow",
            "sad" => "Sad",
            "angry" => "Angry",
            "party" => "PartyHorn",
            "partyhorn" => "PartyHorn",
            "clap" => "Clap",
            "handsclapping" => "Clap",
            "fire" => "Fire",
            _ => string.Empty
        };
    }

    private static ChatConversationDto MapConversationDto(ChatConversation entity, Guid viewerProfileId, ChatMessage? lastMessage)
    {
        var viewerMembership = entity.Members.FirstOrDefault(x => x.ProfileId == viewerProfileId);

        return new ChatConversationDto(
            entity.Id,
            entity.IsGroup,
            entity.Title,
            viewerMembership?.IsMuted ?? false,
            entity.CreatedAtUtc,
            entity.Members
                .OrderBy(x => x.JoinedAtUtc)
                .Select(x => new ChatParticipantDto(x.ProfileId, x.Profile.Handle, x.Profile.DisplayName, x.Profile.ImageUrl, x.JoinedAtUtc))
                .ToArray(),
            lastMessage is null
                ? null
                : new ChatMessagePreviewDto(lastMessage.Id, lastMessage.AuthorProfileId, lastMessage.AuthorProfile.Handle, lastMessage.Content, lastMessage.CreatedAtUtc));
    }

    private static ChatMessageDto MapMessageDto(ChatMessage entity, Guid viewerProfileId)
    {
        var myReaction = entity.Reactions.FirstOrDefault(x => x.ProfileId == viewerProfileId)?.Type;

        var summaries = entity.Reactions
            .GroupBy(x => x.Type)
            .Select(x => new ReactionSummaryDto(x.Key, x.Count()))
            .OrderByDescending(x => x.Count)
            .ThenBy(x => x.Type)
            .ToArray();

        var reactionDetails = entity.Reactions
            .Where(x => x.Profile is not null)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => new PostReactionDetailDto(
                x.ProfileId,
                x.Profile.Handle,
                x.Profile.DisplayName,
                x.Profile.Bio,
                x.Profile.ImageUrl,
                x.Type,
                x.CreatedAtUtc))
            .ToArray();

        return new ChatMessageDto(
            entity.Id,
            entity.ConversationId,
            entity.AuthorProfileId,
            entity.AuthorProfile.Handle,
            entity.AuthorProfile.ImageUrl,
            entity.Content,
            entity.CreatedAtUtc,
            entity.EditedAtUtc,
            myReaction,
            summaries,
            reactionDetails);
    }

    private async Task<ChatMessageDto?> HydrateMessageDtoAsync(Guid messageId, Guid viewerProfileId, CancellationToken cancellationToken)
    {
        var hydrated = await dbContext.ChatMessages
            .AsNoTracking()
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
                .ThenInclude(x => x.Profile)
            .FirstOrDefaultAsync(x => x.Id == messageId, cancellationToken);

        return hydrated is null ? null : MapMessageDto(hydrated, viewerProfileId);
    }
}
