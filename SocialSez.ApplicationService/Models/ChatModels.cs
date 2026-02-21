namespace SocialSez.ApplicationService.Models;

public sealed record CreateDirectConversationRequest(Guid OtherProfileId);

public sealed record CreateGroupConversationRequest(string? Title, IReadOnlyCollection<Guid> MemberProfileIds);

public sealed record CreateChatMessageRequest(string Content);

public sealed record SetMessageReactionRequest(string Type);

public sealed record ChatParticipantDto(
    Guid ProfileId,
    string Handle,
    string DisplayName,
    string? ImageUrl,
    DateTime JoinedAtUtc);

public sealed record ChatMessagePreviewDto(
    Guid Id,
    Guid AuthorProfileId,
    string AuthorHandle,
    string Content,
    DateTime CreatedAtUtc);

public sealed record ChatConversationDto(
    Guid Id,
    bool IsGroup,
    string? Title,
    DateTime CreatedAtUtc,
    IReadOnlyCollection<ChatParticipantDto> Participants,
    ChatMessagePreviewDto? LastMessage);

public sealed record ChatMessageDto(
    Guid Id,
    Guid ConversationId,
    Guid AuthorProfileId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string Content,
    DateTime CreatedAtUtc,
    string? MyReactionType,
    IReadOnlyCollection<ReactionSummaryDto> Reactions);
