using Microsoft.EntityFrameworkCore;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.Domain.Entities;
using SocialSez.Infrastructure;

namespace SocialSez.ApplicationService.Services;

public class NotificationService(SocialSezContext dbContext) : INotificationService
{
    private const int AggregationFetchFloor = 300;
    private static readonly HashSet<string> AggregatableTypes = new(StringComparer.Ordinal)
    {
        "PostLike",
        "PostReaction",
        "PostComment",
        "ReelLike",
        "ReelComment",
        "CommunityPostUpvote",
        "CommunityPostComment"
    };

    public async Task<IReadOnlyCollection<NotificationDto>> GetForRecipientAsync(Guid recipientId, int take = 50, CancellationToken cancellationToken = default)
    {
        var normalizedTake = Math.Clamp(take, 1, 200);
        var fetchSize = Math.Max(normalizedTake * 4, AggregationFetchFloor);

        var notifications = await dbContext.Notifications
            .AsNoTracking()
            .Include(x => x.Actor)
            .Where(x => x.RecipientId == recipientId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(fetchSize)
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

        var result = new List<NotificationDto>(notifications.Count);
        var seenAggregateGroups = new HashSet<string>(StringComparer.Ordinal);

        foreach (var notification in notifications)
        {
            var normalizedType = GetAggregateType(notification.Type);
            var normalizedNotification = NormalizeNotificationMessage(notification, normalizedType);

            if (!CanAggregate(notification))
            {
                result.Add(normalizedNotification);
                continue;
            }

            var aggregateKey = BuildAggregateKey(normalizedType, notification.ReferenceId!);
            if (!seenAggregateGroups.Add(aggregateKey))
            {
                continue;
            }

            var group = notifications
                .Where(x => !x.IsRead
                    && string.Equals(GetAggregateType(x.Type), normalizedType, StringComparison.Ordinal)
                    && string.Equals(x.ReferenceId, notification.ReferenceId, StringComparison.Ordinal))
                .ToArray();

            if (group.Length <= 1)
            {
                result.Add(normalizedNotification);
                continue;
            }

            var actorNames = group
                .Select(x => x.ActorHandle?.Trim())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(10)
                .ToArray();

            var message = BuildAggregateMessage(normalizedType, actorNames);

            result.Add(normalizedNotification with { Type = normalizedType, Message = message });
        }

        return result.Take(normalizedTake).ToArray();
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
            if (CanAggregate(notification))
            {
                var normalizedType = GetAggregateType(notification.Type);

                var groupItems = await dbContext.Notifications
                    .Where(x => x.RecipientId == recipientId
                        && !x.IsRead
                        && x.ReferenceId == notification.ReferenceId)
                    .Where(x => normalizedType == "PostReaction"
                        ? x.Type == "PostLike" || x.Type == "PostReaction"
                        : x.Type == notification.Type)
                    .ToListAsync(cancellationToken);

                foreach (var groupItem in groupItems)
                {
                    groupItem.IsRead = true;
                }
            }
            else
            {
                notification.IsRead = true;
            }

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

    private static bool CanAggregate(NotificationDto notification)
    {
        return !notification.IsRead
            && notification.ActorId.HasValue
            && !string.IsNullOrWhiteSpace(notification.ReferenceId)
            && AggregatableTypes.Contains(notification.Type);
    }

    private static bool CanAggregate(Notification notification)
    {
        return !notification.IsRead
            && !string.IsNullOrWhiteSpace(notification.ReferenceId)
            && AggregatableTypes.Contains(notification.Type);
    }

    private static string BuildAggregateKey(string type, string referenceId)
    {
        return string.Concat(type, "::", referenceId);
    }

    private static string GetAggregateType(string type)
    {
        return type switch
        {
            "PostLike" => "PostReaction",
            _ => type
        };
    }

    private static NotificationDto NormalizeNotificationMessage(NotificationDto notification, string normalizedType)
    {
        if (string.Equals(notification.Type, normalizedType, StringComparison.Ordinal))
        {
            return notification;
        }

        if (string.Equals(notification.Type, "PostLike", StringComparison.Ordinal))
        {
            var updatedMessage = notification.Message
                .Replace(" liked your post.", " reacted to your post.", StringComparison.Ordinal)
                .Replace(" liked your post", " reacted to your post", StringComparison.Ordinal);

            return notification with
            {
                Type = normalizedType,
                Message = updatedMessage
            };
        }

        return notification with { Type = normalizedType };
    }

    private static string BuildAggregateMessage(string type, IReadOnlyCollection<string?> actorNames)
    {
        var descriptor = GetDescriptor(type);
        var names = actorNames
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x!.Trim())
            .ToArray();

        if (names.Length == 0)
        {
            return $"Someone {descriptor}.";
        }

        if (names.Length == 1)
        {
            return $"@{names[0]} {descriptor}.";
        }

        if (names.Length == 2)
        {
            return $"{names[0]} & {names[1]} {descriptor}.";
        }

        if (names.Length == 3)
        {
            return $"{names[0]}, {names[1]} and {names[2]} {descriptor}.";
        }

        return $"{names.Length} people {descriptor}.";
    }

    private static string GetDescriptor(string type)
    {
        return type switch
        {
            "PostLike" => "reacted to your post",
            "PostReaction" => "reacted to your post",
            "PostComment" => "commented on your post",
            "ReelLike" => "liked your reel",
            "ReelComment" => "commented on your reel",
            "CommunityPostUpvote" => "upvoted your community post",
            "CommunityPostComment" => "commented on your community post",
            _ => "interacted with your content"
        };
    }
}
