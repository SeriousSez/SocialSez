import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HashtagSearchResultDto, ReelDto } from '../core/api.types';
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
    private failedProfileChipImageUrl: string | null = null;

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

    shouldRenderProfileChipImage(imageUrl?: string | null): boolean {
        const normalized = imageUrl?.trim();
        if (!normalized) {
            return false;
        }

        return normalized !== this.failedProfileChipImageUrl;
    }

    onProfileChipImageError(imageUrl?: string | null): void {
        const normalized = imageUrl?.trim();
        if (!normalized) {
            return;
        }

        this.failedProfileChipImageUrl = normalized;
    }

    private async loadTrendingHashtags(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.trendingHashtags = [];
            this.loadingTrending = false;
            return;
        }

        this.loadingTrending = true;
        try {
            const [trending, forYouReels, followingReels] = await Promise.allSettled([
                this.session.loadTrendingHashtagsAsync(20),
                this.session.loadReelFeedAsync(80, 'for-you'),
                this.session.loadReelFeedAsync(80, 'following')
            ]);

            const mergedCounts = new Map<string, number>();

            if (trending.status === 'fulfilled') {
                for (const item of trending.value) {
                    const tag = item.tag.trim();
                    if (!tag) {
                        continue;
                    }

                    mergedCounts.set(tag, (mergedCounts.get(tag) ?? 0) + Math.max(0, item.count));
                }
            }

            const reelsById = new Map<string, string>();
            if (forYouReels.status === 'fulfilled') {
                for (const reel of forYouReels.value) {
                    reelsById.set(reel.id, reel.id);
                    this.collectReelHashtags(reel, mergedCounts);
                }
            }

            if (followingReels.status === 'fulfilled') {
                for (const reel of followingReels.value) {
                    if (reelsById.has(reel.id)) {
                        continue;
                    }

                    reelsById.set(reel.id, reel.id);
                    this.collectReelHashtags(reel, mergedCounts);
                }
            }

            this.trendingHashtags = Array.from(mergedCounts.entries())
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
                .slice(0, 3);
        } catch {
            this.trendingHashtags = [];
        } finally {
            this.loadingTrending = false;
        }
    }

    private collectReelHashtags(reel: ReelDto, counts: Map<string, number>): void {
        this.collectHashtagsFromText(reel.caption, counts);
        for (const comment of reel.comments ?? []) {
            this.collectHashtagsFromText(comment.content, counts);
        }
    }

    private collectHashtagsFromText(content: string | null | undefined, counts: Map<string, number>): void {
        const text = (content ?? '').trim();
        if (!text) {
            return;
        }

        const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
        const uniqueTags = new Set<string>();
        for (const match of text.matchAll(hashtagRegex)) {
            const normalized = (match[0] ?? '').slice(1).trim();
            if (!normalized) {
                continue;
            }

            uniqueTags.add(normalized);
        }

        for (const tag of uniqueTags) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
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
