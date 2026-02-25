import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, OnDestroy, OnInit, inject, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HashtagSearchResultDto, ReelDto, StoryDto, StoryGroupDto, ProfileDto } from '../core/api.types';
import { SessionService } from '../core/session.service';
import { MessagesDockComponent } from './messages-dock.component';
import { FeedStoryViewerComponent } from '../pages/feed-page/feed-story-viewer.component';

@Component({
    selector: 'app-root',
    imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, MessagesDockComponent, FeedStoryViewerComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
    readonly showDebug = isDevMode();
    working = false;
    searchText = '';
    trendingHashtags: HashtagSearchResultDto[] = [];
    loadingTrending = false;
    unreadNotificationsCount = 0;
    profileChipHasStory = false;
    profileChipHasUnseenStory = false;
    profileChipFirstStoryId: string | null = null;
    profileChipStoryGroup: StoryGroupDto | null = null;
    profileChipStoryIndex = 0;
    private failedProfileChipImageUrl: string | null = null;
    private readonly prefsStorageKey = 'socialsez-web-prefs';
    private readonly likedProfileChipStoryIds = new Set<string>();
    private markingProfileChipStoryId: string | null = null;
    private pendingProfileChipViewedSync = false;
    private storyStatusPollTimerId: number | null = null;

    private readonly destroyRef = inject(DestroyRef);

    constructor(public readonly session: SessionService, private readonly router: Router) { }

    get showMessagesDock(): boolean {
        return this.session.isAuthenticated() && !this.isChatRoute;
    }

    get isChatRoute(): boolean {
        return this.router.url.startsWith('/chat');
    }

    get isChatThreadRoute(): boolean {
        if (!this.isChatRoute) {
            return false;
        }

        const conversation = this.router.parseUrl(this.router.url).queryParamMap.get('conversation');
        return !!conversation?.trim();
    }

    ngOnInit(): void {
        this.applyThemePreference();

        this.session.appChanges$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(change => {
                if (change === 'posts' || change === 'session') {
                    void this.loadTrendingHashtags();
                    void this.refreshProfileChipStoryStatus();
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
        this.startStoryStatusPolling();
    }

    ngOnDestroy(): void {
        if (this.storyStatusPollTimerId !== null) {
            window.clearInterval(this.storyStatusPollTimerId);
            this.storyStatusPollTimerId = null;
        }
    }

    @HostListener('window:storage', ['$event'])
    onStorageChanged(event: StorageEvent): void {
        if (event.key !== this.prefsStorageKey) {
            return;
        }

        this.applyThemePreference();
    }

    private async initializeAsync(): Promise<void> {
        await this.session.bootstrapAsync();
        await this.loadTrendingHashtags();
        await this.refreshProfileChipStoryStatus();
        await this.loadUnreadNotificationsCountAsync();
    }

    private applyThemePreference(): void {
        const stored = localStorage.getItem(this.prefsStorageKey);
        if (!stored) {
            document.documentElement.classList.remove('theme-dark');
            return;
        }

        try {
            const parsed = JSON.parse(stored) as { darkMode?: boolean };
            document.documentElement.classList.toggle('theme-dark', !!parsed.darkMode);
        } catch {
            document.documentElement.classList.remove('theme-dark');
        }
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

    hasStoryForProfileChip(): boolean {
        return this.profileChipHasStory;
    }

    hasUnseenStoryForProfileChip(): boolean {
        return this.profileChipHasUnseenStory;
    }

    async openProfileChipAvatar(profile: ProfileDto, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        const handle = profile.handle?.trim().toLowerCase();
        if (!handle) {
            await this.router.navigate(['/profile']);
            return;
        }

        try {
            const group = await this.loadProfileChipStoryGroupAsync(handle);
            if (group?.stories.length) {
                this.profileChipHasStory = true;
                this.profileChipHasUnseenStory = this.hasUnseenStories(group);
                this.profileChipFirstStoryId = group.stories[0]?.id ?? null;
                this.profileChipStoryGroup = group;
                this.profileChipStoryIndex = this.getNewestUnseenProfileChipStoryIndex(group.stories);
                void this.markActiveProfileChipStoryViewed();
                return;
            }
        } catch {
            // Fall through to profile navigation when story lookup fails.
        }

        await this.router.navigate(['/profile']);
    }

    private async refreshProfileChipStoryStatus(): Promise<void> {
        const handle = this.session.profile?.handle?.trim().toLowerCase();
        if (!handle) {
            this.profileChipHasStory = false;
            this.profileChipHasUnseenStory = false;
            this.profileChipFirstStoryId = null;
            return;
        }

        try {
            const group = await this.loadProfileChipStoryGroupAsync(handle);
            this.profileChipHasStory = !!group?.stories.length;
            this.profileChipHasUnseenStory = group ? this.hasUnseenStories(group) : false;
            this.profileChipFirstStoryId = group?.stories[0]?.id ?? null;
        } catch {
            this.profileChipHasStory = false;
            this.profileChipHasUnseenStory = false;
            this.profileChipFirstStoryId = null;
        }
    }

    closeProfileChipStoryViewer(): void {
        this.profileChipStoryGroup = null;
        this.profileChipStoryIndex = 0;
    }

    showPreviousProfileChipStory(): void {
        if (this.profileChipStoryIndex <= 0) {
            return;
        }

        this.profileChipStoryIndex -= 1;
        void this.markActiveProfileChipStoryViewed();
    }

    showNextProfileChipStory(): void {
        const group = this.profileChipStoryGroup;
        if (!group) {
            return;
        }

        if (this.profileChipStoryIndex >= group.stories.length - 1) {
            this.closeProfileChipStoryViewer();
            return;
        }

        this.profileChipStoryIndex += 1;
        void this.markActiveProfileChipStoryViewed();
    }

    isProfileChipStoryLiked(storyId: string): boolean {
        return this.likedProfileChipStoryIds.has(storyId);
    }

    toggleProfileChipStoryLike(story: StoryDto): void {
        if (this.likedProfileChipStoryIds.has(story.id)) {
            this.likedProfileChipStoryIds.delete(story.id);
            return;
        }

        this.likedProfileChipStoryIds.add(story.id);
    }

    get activeProfileChipStory(): StoryDto | null {
        if (!this.profileChipStoryGroup) {
            return null;
        }

        return this.profileChipStoryGroup.stories[this.profileChipStoryIndex] ?? null;
    }

    get hasPreviousProfileChipStory(): boolean {
        return this.profileChipStoryIndex > 0;
    }

    get hasNextProfileChipStory(): boolean {
        return !!this.profileChipStoryGroup && this.profileChipStoryIndex < this.profileChipStoryGroup.stories.length - 1;
    }

    private getNewestUnseenProfileChipStoryIndex(stories: StoryDto[]): number {
        if (!stories.some(story => story.viewedByMe)) {
            let oldestIndex = 0;
            let oldestTimestamp = Number.POSITIVE_INFINITY;

            for (let index = 0; index < stories.length; index += 1) {
                const parsedTimestamp = Date.parse(stories[index].createdAtUtc);
                const timestamp = Number.isNaN(parsedTimestamp) ? Number.POSITIVE_INFINITY : parsedTimestamp;
                if (timestamp < oldestTimestamp) {
                    oldestTimestamp = timestamp;
                    oldestIndex = index;
                }
            }

            return oldestIndex;
        }

        let selectedIndex = -1;
        let selectedTimestamp = Number.NEGATIVE_INFINITY;

        for (let index = 0; index < stories.length; index += 1) {
            const story = stories[index];
            if (story.viewedByMe) {
                continue;
            }

            const parsedTimestamp = Date.parse(story.createdAtUtc);
            const timestamp = Number.isNaN(parsedTimestamp) ? Number.NEGATIVE_INFINITY : parsedTimestamp;
            if (selectedIndex < 0 || timestamp > selectedTimestamp) {
                selectedIndex = index;
                selectedTimestamp = timestamp;
            }
        }

        return selectedIndex >= 0 ? selectedIndex : 0;
    }

    private async markActiveProfileChipStoryViewed(): Promise<void> {
        const story = this.activeProfileChipStory;
        if (!story || story.viewedByMe) {
            return;
        }

        if (this.markingProfileChipStoryId) {
            this.pendingProfileChipViewedSync = true;
            return;
        }

        this.markingProfileChipStoryId = story.id;
        try {
            await this.session.markStoryViewedAsync(story.id);
            this.markProfileChipStoryViewedLocally(story.id);
        } catch {
            return;
        } finally {
            this.markingProfileChipStoryId = null;
            if (this.pendingProfileChipViewedSync) {
                this.pendingProfileChipViewedSync = false;
                void this.markActiveProfileChipStoryViewed();
            }
        }
    }

    private markProfileChipStoryViewedLocally(storyId: string): void {
        const group = this.profileChipStoryGroup;
        if (!group) {
            return;
        }

        const updatedStories = group.stories.map(story => story.id === storyId ? { ...story, viewedByMe: true } : story);
        this.profileChipStoryGroup = {
            ...group,
            stories: updatedStories,
            hasUnseenStories: updatedStories.some(story => !story.viewedByMe)
        };

        this.profileChipHasStory = updatedStories.length > 0;
        this.profileChipHasUnseenStory = this.hasUnseenStories(this.profileChipStoryGroup);
        this.profileChipFirstStoryId = updatedStories[0]?.id ?? null;
    }

    private hasUnseenStories(group: StoryGroupDto): boolean {
        if (!group.stories.length) {
            return false;
        }

        return group.stories.some(story => !story.viewedByMe);
    }

    private async loadProfileChipStoryGroupAsync(handle: string): Promise<StoryGroupDto | null> {
        const normalized = handle.trim().toLowerCase();

        if (this.session.isAuthenticated()) {
            try {
                const [forYou, following] = await Promise.allSettled([
                    this.session.loadStoryFeedAsync(80, 'for-you'),
                    this.session.loadStoryFeedAsync(80, 'following')
                ]);

                const merged = [
                    ...(forYou.status === 'fulfilled' ? forYou.value : []),
                    ...(following.status === 'fulfilled' ? following.value : [])
                ];

                const matched = merged.find(group => group.authorHandle.trim().toLowerCase() === normalized);
                if (matched) {
                    return matched;
                }
            } catch {
                // Fall back to public endpoint below.
            }
        }

        return this.session.loadPublicStoriesByAuthorHandleAsync(normalized);
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

    private startStoryStatusPolling(): void {
        if (this.storyStatusPollTimerId !== null) {
            return;
        }

        this.storyStatusPollTimerId = window.setInterval(() => {
            if (!this.session.isAuthenticated() || document.hidden) {
                return;
            }

            void this.refreshProfileChipStoryStatus();
        }, 30000);
    }
}
