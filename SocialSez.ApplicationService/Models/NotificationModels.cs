namespace SocialSez.ApplicationService.Models;

public sealed record NotificationDto(
    Guid Id,
    Guid RecipientId,
    Guid? ActorId,
    string? ActorHandle,
    string Type,
    string Message,
    string? ReferenceId,
    bool IsRead,
    DateTime CreatedAtUtc);
