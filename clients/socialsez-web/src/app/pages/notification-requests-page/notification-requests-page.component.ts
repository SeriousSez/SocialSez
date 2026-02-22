import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FollowRequestDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-notification-requests-page',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './notification-requests-page.component.html',
    styleUrl: './notification-requests-page.component.scss'
})
export class NotificationRequestsPageComponent {
    requests: FollowRequestDto[] = [];
    loading = false;
    status = '';

    constructor(private readonly session: SessionService) {
        void this.loadRequests();
    }

    async loadRequests(): Promise<void> {
        this.loading = true;
        this.status = '';

        try {
            this.requests = await this.session.loadIncomingFollowRequestsAsync();
        } catch {
            this.status = 'Could not load follow requests.';
        } finally {
            this.loading = false;
        }
    }

    async approveRequest(followerId: string): Promise<void> {
        try {
            await this.session.approveFollowRequestAsync(followerId);
            this.requests = this.requests.filter(x => x.followerId !== followerId);
        } catch {
            this.status = 'Could not approve request.';
        }
    }

    async declineRequest(followerId: string): Promise<void> {
        try {
            await this.session.declineFollowRequestAsync(followerId);
            this.requests = this.requests.filter(x => x.followerId !== followerId);
        } catch {
            this.status = 'Could not decline request.';
        }
    }
}
