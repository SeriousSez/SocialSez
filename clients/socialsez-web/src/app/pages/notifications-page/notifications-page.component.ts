import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NotificationDto } from '../../core/api.types';
import { NotificationsRealtimeService } from '../../core/notifications-realtime.service';
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
    activeFilter: 'all' | 'unread' = 'all';
    readonly skeletonRows = Array.from({ length: 4 }, (_, index) => index);
    private readonly session = inject(SessionService);
    private readonly router = inject(Router);
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly destroyRef = inject(DestroyRef);
    private readonly notificationsRealtime = inject(NotificationsRealtimeService);

    constructor() {
        this.notificationsRealtime.notificationCreated$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(notification => {
                const currentProfileId = this.session.profile?.id;
                if (!currentProfileId || notification.recipientId !== currentProfileId) {
                    return;
                }

                const exists = this.notifications.some(item => item.id === notification.id);
                if (exists) {
                    return;
                }

                this.notifications = [notification, ...this.notifications].slice(0, 100);
                this.cdr.detectChanges();
            });

        void this.loadNotifications();
    }

    get unreadCount(): number {
        return this.notifications.filter(notification => !notification.isRead).length;
    }

    get filteredNotifications(): NotificationDto[] {
        if (this.activeFilter === 'unread') {
            return this.notifications.filter(notification => !notification.isRead);
        }

        return this.notifications;
    }

    setFilter(filter: 'all' | 'unread'): void {
        this.activeFilter = filter;
    }

    trackByNotification(_index: number, notification: NotificationDto): string {
        return notification.id;
    }

    isFollowRequest(notification: NotificationDto): boolean {
        return notification.type === 'FollowRequest';
    }

    async loadNotifications(): Promise<void> {
        this.loading = true;

        try {
            this.notifications = await this.session.loadNotificationsAsync();
        } catch {
            this.session.message = 'Could not load notifications.';
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }

    async markRead(notificationId: string): Promise<void> {
        const target = this.notifications.find(notification => notification.id === notificationId);
        if (!target || target.isRead) {
            return;
        }

        try {
            await this.session.markNotificationReadAsync(notificationId);
            this.notifications = this.notifications.map(notification =>
                notification.id === notificationId ? { ...notification, isRead: true } : notification);
            this.cdr.detectChanges();
        } catch {
            this.session.message = 'Could not mark notification as read.';
            this.cdr.detectChanges();
        }
    }

    async markAllRead(): Promise<void> {
        try {
            const updatedCount = await this.session.markAllNotificationsReadAsync();
            this.notifications = this.notifications.map(notification => ({ ...notification, isRead: true }));
            this.session.message = updatedCount > 0
                ? 'All notifications marked as read.'
                : 'No unread notifications to mark as read.';
            this.cdr.detectChanges();
        } catch {
            this.session.message = 'Could not mark all notifications as read.';
            this.cdr.detectChanges();
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

        if (!notification.actorId) {
            this.session.message = 'This request is missing profile details.';
            return;
        }

        try {
            await this.session.approveFollowRequestAsync(notification.actorId);
            if (!notification.isRead) {
                await this.session.markNotificationReadAsync(notification.id);
            }

            this.notifications = this.notifications.map(item =>
                item.id === notification.id ? { ...item, isRead: true } : item);
            this.session.message = 'Follow request approved.';
            this.cdr.detectChanges();
        } catch {
            this.session.message = 'Could not approve follow request.';
            this.cdr.detectChanges();
        }
    }

    async declineRequest(notification: NotificationDto, event: Event): Promise<void> {
        event.stopPropagation();

        if (!notification.actorId) {
            this.session.message = 'This request is missing profile details.';
            return;
        }

        try {
            await this.session.declineFollowRequestAsync(notification.actorId);
            if (!notification.isRead) {
                await this.session.markNotificationReadAsync(notification.id);
            }

            this.notifications = this.notifications.map(item =>
                item.id === notification.id ? { ...item, isRead: true } : item);
            this.session.message = 'Follow request declined.';
            this.cdr.detectChanges();
        } catch {
            this.session.message = 'Could not decline follow request.';
            this.cdr.detectChanges();
        }
    }
}
