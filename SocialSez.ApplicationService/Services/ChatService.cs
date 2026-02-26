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
        "Like", "Love", "Laugh", "Wow", "Sad", "Angry", "Fire", "Party"
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
            .Select(x => MapConversationDto(x, latestByConversation.TryGetValue(x.Id, out var latest) ? latest : null))
            .OrderByDescending(x => x.LastMessage?.CreatedAtUtc ?? x.CreatedAtUtc)
            .ToArray();
    }

    public async Task<ChatConversationDto> CreateOrGetDirectConversationAsync(Guid profileId, CreateDirectConversationRequest request, CancellationToken cancellationToken = default)
    {
        if (request.OtherProfileId == profileId)
        {
            throw new ArgumentException("You cannot create a direct conversation with yourself.", nameof(request));
        }

        var profileIds = new[] { profileId, request.OtherProfileId };
        var profileCount = await dbContext.UserProfiles.CountAsync(x => profileIds.Contains(x.Id), cancellationToken);
        if (profileCount != 2)
        {
            throw new InvalidOperationException("One or more profiles do not exist.");
        }

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

            return MapConversationDto(existing, lastMessage);
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
        await dbContext.SaveChangesAsync(cancellationToken);

        var created = await dbContext.ChatConversations
            .AsNoTracking()
            .Include(x => x.Members)
                .ThenInclude(x => x.Profile)
            .FirstAsync(x => x.Id == conversation.Id, cancellationToken);

        return MapConversationDto(created, null);
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

        return MapConversationDto(created, null);
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
        if (!await IsMemberAsync(profileId, conversationId, cancellationToken))
        {
            return null;
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

        var hydrated = await dbContext.ChatMessages
            .AsNoTracking()
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
            .FirstOrDefaultAsync(x => x.Id == message.Id, cancellationToken);

        return hydrated is null ? null : MapMessageDto(hydrated, profileId);
    }

    public async Task<ChatMessageDto?> UpdateMessageAsync(Guid profileId, Guid messageId, UpdateChatMessageRequest request, CancellationToken cancellationToken = default)
    {
        var message = await dbContext.ChatMessages
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
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
            return MapMessageDto(message, profileId);
        }

        message.Content = content;
        message.EditedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapMessageDto(message, profileId);
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
        return MapMessageDto(message, profileId);
    }

    public async Task<ChatMessageDto?> ClearMessageReactionAsync(Guid profileId, Guid messageId, CancellationToken cancellationToken = default)
    {
        var message = await dbContext.ChatMessages
            .Include(x => x.AuthorProfile)
            .Include(x => x.Reactions)
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

        return MapMessageDto(message, profileId);
    }

    private async Task<bool> IsMemberAsync(Guid profileId, Guid conversationId, CancellationToken cancellationToken)
    {
        return await dbContext.ChatConversationMembers
            .AsNoTracking()
            .AnyAsync(x => x.ConversationId == conversationId && x.ProfileId == profileId, cancellationToken);
    }

    private static string NormalizeReactionType(string value)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return string.Empty;
        }

        return char.ToUpperInvariant(trimmed[0]) + trimmed[1..].ToLowerInvariant();
    }

    private static ChatConversationDto MapConversationDto(ChatConversation entity, ChatMessage? lastMessage)
    {
        return new ChatConversationDto(
            entity.Id,
            entity.IsGroup,
            entity.Title,
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
            summaries);
    }
}
