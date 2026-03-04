import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, OnDestroy, OnInit, inject, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HashtagSearchResultDto, ReelDto, StoryDto, StoryGroupDto, ProfileDto } from '../core/api.types';
import { SharedReelCommentPreview } from '../core/shared-reel.utils';
import { SessionNoticeEntry, SessionService } from '../core/session.service';
import { MessagesDockComponent } from './messages-dock.component';
import { FeedStoryViewerComponent } from '../pages/feed-page/feed-story-viewer.component';

interface DockReelModalState {
    reelId?: string;
    videoUrl: string;
    thumbnailUrl?: string;
    authorHandle: string;
    authorImageUrl?: string;
    caption?: string;
    createdAtUtc?: string;
    likeCount: number;
    likedByMe: boolean;
    comments: SharedReelCommentPreview[];
    muted: boolean;
}

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
    dockStoryGroup: StoryGroupDto | null = null;
    dockStoryIndex = 0;
    dockReelModal: DockReelModalState | null = null;
    dockReelCommentDraft = '';
    submittingDockReelComment = false;
    togglingDockReelLike = false;
    private failedProfileChipImageUrl: string | null = null;
    private readonly prefsStorageKey = 'socialsez-web-prefs';
    private readonly likedProfileChipStoryIds = new Set<string>();
    private markingProfileChipStoryId: string | null = null;
    private pendingProfileChipViewedSync = false;
    private storyStatusPollTimerId: number | null = null;
    private topNoticeAutoDismissTimerId: number | null = null;
    private topNoticeHideTimerId: number | null = null;
    topNoticeHiding = false;
    private dismissedTopNoticeVersion = 0;
    private readonly topNoticeAnimationDurationMs = 400;
    private readonly updateMessagePattern = /(new\s+version|version\s+available|update\s+available)/i;
    private readonly errorMessagePattern = /(error|failed|could not|unable to|invalid|denied|forbidden|unauthorized|not found|expired)/i;

    private readonly destroyRef = inject(DestroyRef);

    constructor(public readonly session: SessionService, private readonly router: Router) { }

    get topNoticeMessage(): string {
        return this.session.message?.trim() ?? '';
    }

    get showTopNotice(): boolean {
        const message = this.topNoticeMessage;
        return !!message && this.session.messageVersion > this.dismissedTopNoticeVersion;
    }

    get topNoticeVersion(): string {
        return 'v1.1.3';
    }

    get showTopNoticeVersion(): boolean {
        return this.updateMessagePattern.test(this.topNoticeMessage);
    }

    get isTopNoticeError(): boolean {
        return this.isErrorNotice(this.topNoticeMessage);
    }

    get topNoticeActionLabel(): string {
        return 'Dismiss';
    }

    get noticeHistoryPreview(): readonly SessionNoticeEntry[] {
        return this.session.noticeHistory.slice(0, 6);
    }

    get showTopNoticeAction(): boolean {
        return this.isTopNoticeError;
    }

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

        this.session.messageChanges$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                this.onTopNoticeMessageChanged();
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

        this.clearTopNoticeAutoDismissTimer();
        this.clearTopNoticeHideTimer();
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
            const prefersDark = this.prefersSystemDarkMode();
            document.documentElement.classList.toggle('theme-dark', prefersDark);
            localStorage.setItem(this.prefsStorageKey, JSON.stringify({
                compactFeed: false,
                darkMode: prefersDark
            }));
            return;
        }

        try {
            const parsed = JSON.parse(stored) as { darkMode?: boolean };
            document.documentElement.classList.toggle('theme-dark', !!parsed.darkMode);
        } catch {
            const prefersDark = this.prefersSystemDarkMode();
            document.documentElement.classList.toggle('theme-dark', prefersDark);
            localStorage.setItem(this.prefsStorageKey, JSON.stringify({
                compactFeed: false,
                darkMode: prefersDark
            }));
        }
    }

    private prefersSystemDarkMode(): boolean {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-color-scheme: dark)').matches;
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

    dismissTopNotice(): void {
        if (!this.showTopNotice || this.topNoticeHiding) {
            return;
        }

        this.clearTopNoticeAutoDismissTimer();
        this.clearTopNoticeHideTimer();
        this.topNoticeHiding = true;
        this.topNoticeHideTimerId = window.setTimeout(() => {
            this.dismissedTopNoticeVersion = this.session.messageVersion;
            this.topNoticeHiding = false;
            this.clearTopNoticeHideTimer();
        }, this.topNoticeAnimationDurationMs);
    }

    onTopNoticeAction(): void {
        this.dismissTopNotice();
    }

    trackNoticeById(_index: number, entry: SessionNoticeEntry): number {
        return entry.id;
    }

    private onTopNoticeMessageChanged(): void {
        this.clearTopNoticeAutoDismissTimer();

        if (this.topNoticeHiding) {
            this.clearTopNoticeHideTimer();
            this.topNoticeHiding = false;
        }

        if (!this.showTopNotice || this.isErrorNotice(this.topNoticeMessage)) {
            return;
        }

        this.topNoticeAutoDismissTimerId = window.setTimeout(() => {
            this.dismissTopNotice();
        }, 3500);
    }

    private isErrorNotice(message: string): boolean {
        return this.errorMessagePattern.test(message);
    }

    private clearTopNoticeAutoDismissTimer(): void {
        if (this.topNoticeAutoDismissTimerId !== null) {
            window.clearTimeout(this.topNoticeAutoDismissTimerId);
            this.topNoticeAutoDismissTimerId = null;
        }
    }

    private clearTopNoticeHideTimer(): void {
        if (this.topNoticeHideTimerId !== null) {
            window.clearTimeout(this.topNoticeHideTimerId);
            this.topNoticeHideTimerId = null;
        }
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

    onDockSharedMediaRequested(media: {
        kind: 'story' | 'reel';
        mediaUrl: string;
        authorHandle: string;
        authorImageUrl?: string;
        authorProfileId?: string;
        reelId?: string;
        caption?: string;
        createdAtUtc?: string;
        likeCount?: number;
        likedByMe?: boolean;
        comments?: SharedReelCommentPreview[];
        thumbnailUrl?: string;
    }): void {
        if (media.kind === 'story') {
            const fallbackStory = this.buildDockSharedStoryFromRequest(media);

            this.dockReelModal = null;
            this.dockStoryGroup = {
                authorId: fallbackStory.authorId,
                authorHandle: fallbackStory.authorHandle,
                authorImageUrl: fallbackStory.authorImageUrl,
                hasUnseenStories: true,
                stories: [fallbackStory]
            };
            this.dockStoryIndex = 0;
            void this.resolveDockStoryGroup(media, fallbackStory);
            return;
        }

        this.dockStoryGroup = null;
        this.dockStoryIndex = 0;
        this.dockReelModal = {
            reelId: media.reelId,
            videoUrl: media.mediaUrl,
            thumbnailUrl: media.thumbnailUrl,
            authorHandle: media.authorHandle,
            authorImageUrl: media.authorImageUrl,
            caption: media.caption,
            createdAtUtc: media.createdAtUtc,
            likeCount: Math.max(0, media.likeCount ?? 0),
            likedByMe: !!media.likedByMe,
            comments: [...(media.comments ?? [])],
            muted: true
        };
        this.dockReelCommentDraft = '';
        this.submittingDockReelComment = false;
        this.togglingDockReelLike = false;
    }

    closeDockStoryViewer(): void {
        this.dockStoryGroup = null;
        this.dockStoryIndex = 0;
    }

    showPreviousDockStory(): void {
        if (this.dockStoryIndex <= 0) {
            return;
        }

        this.dockStoryIndex -= 1;
    }

    showNextDockStory(): void {
        const group = this.dockStoryGroup;
        if (!group) {
            return;
        }

        if (this.dockStoryIndex >= group.stories.length - 1) {
            this.closeDockStoryViewer();
            return;
        }

        this.dockStoryIndex += 1;
    }

    closeDockReelModal(event?: Event): void {
        event?.stopPropagation();
        this.dockReelModal = null;
        this.dockReelCommentDraft = '';
        this.submittingDockReelComment = false;
        this.togglingDockReelLike = false;
    }

    onDockReelBackdropClick(event: MouseEvent): void {
        if (event.target !== event.currentTarget) {
            return;
        }

        this.closeDockReelModal();
    }

    toggleDockReelSound(): void {
        if (!this.dockReelModal) {
            return;
        }

        this.dockReelModal = {
            ...this.dockReelModal,
            muted: !this.dockReelModal.muted
        };
    }

    async toggleDockReelLike(): Promise<void> {
        const reel = this.dockReelModal;
        if (!reel?.reelId || this.togglingDockReelLike) {
            return;
        }

        this.togglingDockReelLike = true;
        try {
            const updated = await this.session.toggleReelLikeAsync(reel.reelId);
            this.applyDockReelUpdate(updated);
        } finally {
            this.togglingDockReelLike = false;
        }
    }

    async submitDockReelComment(): Promise<void> {
        const reel = this.dockReelModal;
        const content = this.dockReelCommentDraft.trim();
        if (!reel?.reelId || !content || this.submittingDockReelComment) {
            return;
        }

        this.submittingDockReelComment = true;
        try {
            const updated = await this.session.addReelCommentAsync(reel.reelId, content);
            this.applyDockReelUpdate(updated);
            this.dockReelCommentDraft = '';
        } finally {
            this.submittingDockReelComment = false;
        }
    }

    get canSubmitDockReelComment(): boolean {
        return !!this.dockReelModal?.reelId && !!this.dockReelCommentDraft.trim() && !this.submittingDockReelComment;
    }

    get activeDockStory(): StoryDto | null {
        if (!this.dockStoryGroup) {
            return null;
        }

        return this.dockStoryGroup.stories[this.dockStoryIndex] ?? null;
    }

    get hasPreviousDockStory(): boolean {
        return this.dockStoryIndex > 0;
    }

    get hasNextDockStory(): boolean {
        return !!this.dockStoryGroup && this.dockStoryIndex < this.dockStoryGroup.stories.length - 1;
    }

    isDockStoryLiked(_: string): boolean {
        return false;
    }

    toggleDockStoryLike(_: StoryDto): void {
        // no-op for dock-opened shared stories
    }

    private buildDockSharedStoryFromRequest(media: {
        mediaUrl: string;
        authorHandle: string;
        authorImageUrl?: string;
        authorProfileId?: string;
        createdAtUtc?: string;
    }): StoryDto {
        const createdAtUtc = media.createdAtUtc?.trim() || new Date().toISOString();
        return {
            id: `dock-story-${Date.now()}`,
            authorId: media.authorProfileId?.trim() || `dock-shared-story-${media.authorHandle}`,
            authorHandle: media.authorHandle,
            authorImageUrl: media.authorImageUrl,
            caption: '',
            mediaUrl: media.mediaUrl,
            createdAtUtc,
            expiresAtUtc: this.buildDockStoryExpiresAt(createdAtUtc),
            viewedByMe: false,
            viewCount: 0
        };
    }

    private async resolveDockStoryGroup(media: {
        mediaUrl: string;
        authorHandle: string;
        authorProfileId?: string;
    }, fallbackStory: StoryDto): Promise<void> {
        const normalizedHandle = (media.authorHandle ?? '').trim().toLowerCase();
        const authorId = media.authorProfileId?.trim();
        const normalizedMediaUrl = this.normalizeComparableUrl(media.mediaUrl);

        try {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadStoryFeedAsync(80, 'for-you'),
                this.session.loadStoryFeedAsync(80, 'following')
            ]);

            const groups = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            if (!groups.length || !this.dockStoryGroup?.stories.some(story => story.id === fallbackStory.id)) {
                return;
            }

            const matchedGroup = groups.find(group => {
                if (authorId && group.authorId === authorId) {
                    return true;
                }

                return (group.authorHandle ?? '').trim().toLowerCase() === normalizedHandle;
            });

            if (!matchedGroup?.stories.length) {
                return;
            }

            let matchedIndex = matchedGroup.stories.findIndex(story => this.normalizeComparableUrl(story.mediaUrl) === normalizedMediaUrl);
            if (matchedIndex < 0) {
                matchedIndex = this.getNewestUnseenProfileChipStoryIndex(matchedGroup.stories);
            }

            this.dockStoryGroup = matchedGroup;
            this.dockStoryIndex = Math.max(0, matchedIndex);
        } catch {
            // Keep fallback single story when full story group cannot be resolved.
        }
    }

    private buildDockStoryExpiresAt(createdAtUtc: string): string {
        const createdAt = Date.parse(createdAtUtc);
        if (Number.isNaN(createdAt)) {
            return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }

        return new Date(createdAt + 24 * 60 * 60 * 1000).toISOString();
    }

    private normalizeComparableUrl(value: string | null | undefined): string {
        const source = (value ?? '').trim();
        if (!source) {
            return '';
        }

        try {
            const parsed = new URL(source);
            parsed.hash = '';
            return parsed.toString();
        } catch {
            return source;
        }
    }

    private applyDockReelUpdate(reel: ReelDto): void {
        if (!this.dockReelModal) {
            return;
        }

        this.dockReelModal = {
            ...this.dockReelModal,
            reelId: reel.id,
            videoUrl: reel.videoUrl || this.dockReelModal.videoUrl,
            thumbnailUrl: reel.thumbnailUrl || this.dockReelModal.thumbnailUrl,
            authorHandle: reel.authorHandle || this.dockReelModal.authorHandle,
            authorImageUrl: reel.authorImageUrl || this.dockReelModal.authorImageUrl,
            caption: reel.caption || this.dockReelModal.caption,
            createdAtUtc: reel.createdAtUtc || this.dockReelModal.createdAtUtc,
            likeCount: reel.likeCount,
            likedByMe: reel.likedByMe,
            comments: reel.comments.map(comment => ({
                id: comment.id,
                parentCommentId: comment.parentCommentId,
                authorHandle: comment.authorHandle,
                authorImageUrl: comment.authorImageUrl,
                content: comment.content,
                createdAtUtc: comment.createdAtUtc,
                likeCount: comment.likeCount,
                likedByMe: comment.likedByMe
            }))
        };
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
