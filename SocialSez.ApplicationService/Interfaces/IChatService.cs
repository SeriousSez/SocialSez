using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IChatService
{
    Task<bool> IsConversationMemberAsync(Guid profileId, Guid conversationId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ChatConversationDto>> GetConversationsAsync(Guid profileId, CancellationToken cancellationToken = default);
    Task<ChatConversationDto> CreateOrGetDirectConversationAsync(Guid profileId, CreateDirectConversationRequest request, CancellationToken cancellationToken = default);
    Task<ChatConversationDto> CreateGroupConversationAsync(Guid profileId, CreateGroupConversationRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ChatMessageDto>?> GetMessagesAsync(Guid profileId, Guid conversationId, int take = 50, int skip = 0, CancellationToken cancellationToken = default);
    Task<ChatMessageDto?> SendMessageAsync(Guid profileId, Guid conversationId, CreateChatMessageRequest request, CancellationToken cancellationToken = default);
    Task<ChatMessageDto?> UpdateMessageAsync(Guid profileId, Guid messageId, UpdateChatMessageRequest request, CancellationToken cancellationToken = default);
    Task<ChatMessageDto?> SetMessageReactionAsync(Guid profileId, Guid messageId, SetMessageReactionRequest request, CancellationToken cancellationToken = default);
    Task<ChatMessageDto?> ClearMessageReactionAsync(Guid profileId, Guid messageId, CancellationToken cancellationToken = default);
}
