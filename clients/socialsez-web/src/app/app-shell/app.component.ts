import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HashtagSearchResultDto } from '../core/api.types';
import { SessionService } from '../core/session.service';
import { MessagesDockComponent } from './messages-dock.component';

@Component({
    selector: 'app-root',
    imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, MessagesDockComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
    readonly showDebug = isDevMode();
    working = false;
    searchText = '';
    trendingHashtags: HashtagSearchResultDto[] = [];
    loadingTrending = false;
    unreadNotificationsCount = 0;

    private readonly destroyRef = inject(DestroyRef);

    constructor(public readonly session: SessionService, private readonly router: Router) { }

    get showMessagesDock(): boolean {
        return this.session.isAuthenticated() && !this.isChatRoute;
    }

    get isChatRoute(): boolean {
        return this.router.url.startsWith('/chat');
    }

    ngOnInit(): void {
        this.session.appChanges$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(change => {
                if (change === 'posts' || change === 'session') {
                    void this.loadTrendingHashtags();
                }

                if (change === 'session' || change === 'notifications') {
                    void this.loadUnreadNotificationsCountAsync();
                }
            });

        this.router.events
            .pipe(
                filter(event => event instanceof NavigationEnd),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                if (!this.session.isAuthenticated()) {
                    this.unreadNotificationsCount = 0;
                    return;
                }

                void this.loadUnreadNotificationsCountAsync();
            });

        void this.initializeAsync();
    }

    private async initializeAsync(): Promise<void> {
        await this.session.bootstrapAsync();
        await this.loadTrendingHashtags();
        await this.loadUnreadNotificationsCountAsync();
    }

    async logout(): Promise<void> {
        this.working = true;
        try {
            await this.session.logoutAsync();
        } finally {
            this.working = false;
        }
    }

    async searchNow(): Promise<void> {
        const query = this.searchText.trim();
        if (!query) {
            return;
        }

        await this.router.navigate(['/discover'], { queryParams: { q: query, type: 'all' } });
    }

    private async loadTrendingHashtags(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.trendingHashtags = [];
            this.loadingTrending = false;
            return;
        }

        this.loadingTrending = true;
        try {
            this.trendingHashtags = await this.session.loadTrendingHashtagsAsync(3);
        } catch {
            this.trendingHashtags = [];
        } finally {
            this.loadingTrending = false;
        }
    }

    private async loadUnreadNotificationsCountAsync(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.unreadNotificationsCount = 0;
            return;
        }

        try {
            const notifications = await this.session.loadNotificationsAsync(100);
            this.unreadNotificationsCount = notifications.filter(notification => !notification.isRead).length;
        } catch {
            this.unreadNotificationsCount = 0;
        }
    }
}
