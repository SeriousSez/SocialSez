import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NotificationDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-notifications-page',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './notifications-page.component.html',
    styleUrl: './notifications-page.component.scss'
})
export class NotificationsPageComponent {
    notifications: NotificationDto[] = [];
    loading = false;
    status = '';
    statusTone: 'neutral' | 'success' | 'error' = 'neutral';

    constructor(private readonly session: SessionService, private readonly router: Router) {
        void this.loadNotifications();
    }

    isFollowRequest(notification: NotificationDto): boolean {
        return notification.type === 'FollowRequest';
    }

    async loadNotifications(): Promise<void> {
        this.loading = true;
        this.resetStatus();

        try {
            this.notifications = await this.session.loadNotificationsAsync();
        } catch {
            this.status = 'Could not load notifications.';
            this.statusTone = 'error';
        } finally {
            this.loading = false;
        }
    }

    async markRead(notificationId: string): Promise<void> {
        this.resetStatus();

        try {
            await this.session.markNotificationReadAsync(notificationId);
            this.notifications = this.notifications.map(notification =>
                notification.id === notificationId ? { ...notification, isRead: true } : notification);
        } catch {
            this.status = 'Could not mark notification as read.';
            this.statusTone = 'error';
        }
    }

    async markAllRead(): Promise<void> {
        this.resetStatus();

        try {
            const updatedCount = await this.session.markAllNotificationsReadAsync();
            this.notifications = this.notifications.map(notification => ({ ...notification, isRead: true }));
            this.status = updatedCount > 0 ? `${updatedCount} notifications marked as read.` : 'No unread notifications.';
            this.statusTone = updatedCount > 0 ? 'success' : 'neutral';
        } catch {
            this.status = 'Could not mark notifications as read.';
            this.statusTone = 'error';
        }
    }

    async openRequest(notification: NotificationDto): Promise<void> {
        if (!this.isFollowRequest(notification)) {
            return;
        }

        if (!notification.isRead) {
            await this.markRead(notification.id);
        }

        await this.router.navigateByUrl('/notifications/requests');
    }

    async approveRequest(notification: NotificationDto, event: Event): Promise<void> {
        event.stopPropagation();
        this.resetStatus();

        if (!notification.actorId) {
            this.status = 'Request information is missing.';
            this.statusTone = 'neutral';
            return;
        }

        try {
            await this.session.approveFollowRequestAsync(notification.actorId);
            if (!notification.isRead) {
                await this.session.markNotificationReadAsync(notification.id);
            }

            this.notifications = this.notifications.map(item =>
                item.id === notification.id ? { ...item, isRead: true } : item);
            this.status = 'Follow request approved.';
            this.statusTone = 'success';
        } catch {
            this.status = 'Could not approve request.';
            this.statusTone = 'error';
        }
    }

    async declineRequest(notification: NotificationDto, event: Event): Promise<void> {
        event.stopPropagation();
        this.resetStatus();

        if (!notification.actorId) {
            this.status = 'Request information is missing.';
            this.statusTone = 'neutral';
            return;
        }

        try {
            await this.session.declineFollowRequestAsync(notification.actorId);
            if (!notification.isRead) {
                await this.session.markNotificationReadAsync(notification.id);
            }

            this.notifications = this.notifications.map(item =>
                item.id === notification.id ? { ...item, isRead: true } : item);
            this.status = 'Follow request declined.';
            this.statusTone = 'success';
        } catch {
            this.status = 'Could not decline request.';
            this.statusTone = 'error';
        }
    }

    private resetStatus(): void {
        this.status = '';
        this.statusTone = 'neutral';
    }
}
