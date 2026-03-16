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
    status = '';
    statusTone: 'neutral' | 'success' | 'error' = 'neutral';
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
        this.resetStatus();

        try {
            this.notifications = await this.session.loadNotificationsAsync();
        } catch {
            this.status = 'Could not load notifications.';
            this.statusTone = 'error';
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

        this.resetStatus();

        try {
            await this.session.markNotificationReadAsync(notificationId);
            this.notifications = this.notifications.map(notification =>
                notification.id === notificationId ? { ...notification, isRead: true } : notification);
            this.cdr.detectChanges();
        } catch {
            this.status = 'Could not mark notification as read.';
            this.statusTone = 'error';
            this.cdr.detectChanges();
        }
    }

    async markAllRead(): Promise<void> {
        this.resetStatus();

        try {
            const updatedCount = await this.session.markAllNotificationsReadAsync();
            this.notifications = this.notifications.map(notification => ({ ...notification, isRead: true }));
            this.status = updatedCount > 0 ? `${updatedCount} notifications marked as read.` : 'No unread notifications.';
            this.statusTone = updatedCount > 0 ? 'success' : 'neutral';
            this.cdr.detectChanges();
        } catch {
            this.status = 'Could not mark notifications as read.';
            this.statusTone = 'error';
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
            this.cdr.detectChanges();
        } catch {
            this.status = 'Could not approve request.';
            this.statusTone = 'error';
            this.cdr.detectChanges();
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
            this.cdr.detectChanges();
        } catch {
            this.status = 'Could not decline request.';
            this.statusTone = 'error';
            this.cdr.detectChanges();
        }
    }

    private resetStatus(): void {
        this.status = '';
        this.statusTone = 'neutral';
    }
}
