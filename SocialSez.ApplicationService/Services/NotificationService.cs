using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class NotificationService(SocialSezContext dbContext) : INotificationService
{
    public async Task<IReadOnlyCollection<NotificationDto>> GetForRecipientAsync(Guid recipientId, int take = 50, CancellationToken cancellationToken = default)
    {
        var normalizedTake = Math.Clamp(take, 1, 200);

        return await dbContext.Notifications
            .AsNoTracking()
            .Include(x => x.Actor)
            .Where(x => x.RecipientId == recipientId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(normalizedTake)
            .Select(x => new NotificationDto(
                x.Id,
                x.RecipientId,
                x.ActorId,
                x.Actor != null ? x.Actor.Handle : null,
                x.Type,
                x.Message,
                x.ReferenceId,
                x.IsRead,
                x.CreatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> MarkReadAsync(Guid notificationId, Guid recipientId, CancellationToken cancellationToken = default)
    {
        var notification = await dbContext.Notifications
            .FirstOrDefaultAsync(x => x.Id == notificationId && x.RecipientId == recipientId, cancellationToken);

        if (notification is null)
        {
            return false;
        }

        if (!notification.IsRead)
        {
            notification.IsRead = true;
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return true;
    }

    public async Task<int> MarkAllReadAsync(Guid recipientId, CancellationToken cancellationToken = default)
    {
        var notifications = await dbContext.Notifications
            .Where(x => x.RecipientId == recipientId && !x.IsRead)
            .ToListAsync(cancellationToken);

        foreach (var notification in notifications)
        {
            notification.IsRead = true;
        }

        if (notifications.Count > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return notifications.Count;
    }
}
