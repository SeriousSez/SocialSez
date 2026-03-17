using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface INotificationService
{
    Task<IReadOnlyCollection<NotificationDto>> GetForRecipientAsync(Guid recipientId, int take = 50, CancellationToken cancellationToken = default);
    Task<bool> MarkReadAsync(Guid notificationId, Guid recipientId, CancellationToken cancellationToken = default);
    Task<bool> MarkUnreadAsync(Guid notificationId, Guid recipientId, CancellationToken cancellationToken = default);
    Task<int> MarkAllReadAsync(Guid recipientId, CancellationToken cancellationToken = default);
}
