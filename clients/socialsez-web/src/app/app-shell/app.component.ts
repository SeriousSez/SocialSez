import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnDestroy, OnInit, inject, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, firstValueFrom } from 'rxjs';
import { CommunityDto, CommunityRuleDto, HashtagSearchResultDto, ReelDto, StoryDto, StoryGroupDto, ProfileDto } from '../core/api.types';
import { AppLanguageService } from '../core/app-language.service';
import { SharedReelCommentPreview } from '../core/shared-reel.utils';
import { OpenReelInModalRequest, PendingSaveToCollectionRequest, SessionNoticeEntry, SessionService } from '../core/session.service';
import { NotificationsRealtimeService } from '../core/notifications-realtime.service';
import { SocialSezApiService } from '../core/socialsez-api.service';
import { UploadProgressService } from '../core/upload-progress.service';
import { ProgressItem } from '../core/upload-progress.service';
import { MessagesDockComponent } from './messages-dock.component';
import { FeedStoryViewerComponent } from '../pages/feed-page/feed-story-viewer.component';
import { CommunityInfoRailComponent } from './community-info-rail.component';
import { SavedCollectionsRailComponent } from './saved-collections-rail.component';
import { SaveToCollectionModalComponent } from '../shared/save-to-collection-modal/save-to-collection-modal.component';
import { FeedRightRailComponent } from './feed-right-rail.component';

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
    collectionId?: string;
    savedItemId?: string;
    onRemoveFromCollection?: () => Promise<boolean>;
}

type SearchDiscoverType = 'all' | 'users' | 'posts' | 'hashtags' | 'reels' | 'communities' | 'community-posts' | 'blogs';

interface SearchScopeOption {
    value: SearchDiscoverType;
    label: string;
}

interface RoutePreviewMeta {
    title: string;
    description: string;
    imageUrl?: string;
    type?: 'website' | 'article' | 'video.other' | 'profile';
}

@Component({
    selector: 'app-root',
    imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, MessagesDockComponent, FeedStoryViewerComponent, CommunityInfoRailComponent, SavedCollectionsRailComponent, SaveToCollectionModalComponent, FeedRightRailComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
    readonly showDebug = isDevMode();
    working = false;
    searchText = '';
    trendingHashtags: HashtagSearchResultDto[] = [];
    loadingTrending = false;
    loadingRightRailCommunity = false;
    savingRightRailRules = false;
    unreadNotificationsCount = 0;
    mobileFooterMenuOpen = false;
    searchScopePickerOpen = false;
    manualSearchScope: SearchDiscoverType | null = null;
    rightRailCommunity: CommunityDto | null = null;
    profileChipHasStory = false;
    profileChipHasUnseenStory = false;
    profileChipFirstStoryId: string | null = null;
    profileChipStoryGroup: StoryGroupDto | null = null;
    profileChipStoryIndex = 0;
    profileChipStoryViewerError = '';
    deletingProfileChipStory = false;
    dockStoryGroup: StoryGroupDto | null = null;
    dockStoryIndex = 0;
    dockReelModal: DockReelModalState | null = null;
    saveToCollectionRequest: PendingSaveToCollectionRequest | null = null;
    dockReelCommentDraft = '';
    submittingDockReelComment = false;
    togglingDockReelLike = false;
    removingDockReelFromCollection = false;
    private failedProfileChipImageUrl: string | null = null;
    private readonly prefsStorageKey = 'socialsez-web-prefs';
    private readonly likedProfileChipStoryIds = new Set<string>();
    private markingProfileChipStoryId: string | null = null;
    private pendingProfileChipViewedSync = false;
    private storyStatusPollTimerId: number | null = null;
    private notificationsPollTimerId: number | null = null;
    private topNoticeAutoDismissTimerId: number | null = null;
    private topNoticeHideTimerId: number | null = null;
    private updateCheckTimerId: number | null = null;
    topNoticeHiding = false;
    private dismissedTopNoticeVersion = 0;
    private readonly topNoticeAnimationDurationMs = 400;
    private readonly updateMessagePattern = /(new\s+version|version\s+available|update\s+available)/i;
    private readonly errorMessagePattern = /(error|failed|could not|unable to|invalid|denied|forbidden|unauthorized|not found|expired)/i;
    private readonly defaultMetaTitle = 'Venli';
    private readonly defaultMetaDescription = 'Build, post, discover and follow in one flow.';
    private readonly defaultMetaImagePath = '/assets/images/v-blue-close.png';
    private metaRequestVersion = 0;
    private appUpdateAvailable = false;
    private appUpdateVersionLabel = '';
    private reloadingForUpdate = false;
    private readonly seenRealtimeNotificationIds = new Set<string>();
    private lastMobileFooterTouchNavigateAt = 0;

    private readonly destroyRef = inject(DestroyRef);
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly appLanguage = inject(AppLanguageService);
    private readonly notificationsRealtime = inject(NotificationsRealtimeService);
    private readonly translate = inject(TranslateService);

    constructor(
        public readonly session: SessionService,
        private readonly router: Router,
        private readonly api: SocialSezApiService,
        private readonly swUpdate: SwUpdate,
        private readonly titleService: Title,
        private readonly metaService: Meta,
        readonly uploadProgress: UploadProgressService
    ) { }

    get topNoticeMessage(): string {
        if (this.appUpdateAvailable) {
            return this.updateNoticeMessage;
        }

        return this.session.message?.trim() ?? '';
    }

    get showTopNotice(): boolean {
        if (this.appUpdateAvailable) {
            return true;
        }

        const message = this.topNoticeMessage;
        return !!message && this.session.messageVersion > this.dismissedTopNoticeVersion;
    }

    get topNoticeVersion(): string {
        if (this.appUpdateAvailable) {
            return this.appUpdateVersionLabel || this.translate.instant('app.notice.updateReady');
        }

        return 'v1.1.3';
    }

    get showTopNoticeVersion(): boolean {
        if (this.appUpdateAvailable) {
            return true;
        }

        return this.updateMessagePattern.test(this.topNoticeMessage);
    }

    get isTopNoticeError(): boolean {
        if (this.appUpdateAvailable) {
            return false;
        }

        return this.isErrorNotice(this.topNoticeMessage);
    }

    get topNoticeActionLabel(): string {
        if (this.appUpdateAvailable) {
            return this.reloadingForUpdate
                ? this.translate.instant('app.notice.reloading')
                : this.translate.instant('app.notice.reload');
        }

        return this.translate.instant('app.notice.dismiss');
    }

    get searchScopeOptions(): ReadonlyArray<SearchScopeOption> {
        return [
            { value: 'all', label: this.translate.instant('app.search.scope.all') },
            { value: 'communities', label: this.translate.instant('app.search.scope.communities') },
            { value: 'community-posts', label: this.translate.instant('app.search.scope.communityPosts') },
            { value: 'blogs', label: this.translate.instant('app.search.scope.blogs') },
            { value: 'users', label: this.translate.instant('app.search.scope.users') },
            { value: 'posts', label: this.translate.instant('app.search.scope.posts') },
            { value: 'reels', label: this.translate.instant('app.search.scope.reels') },
            { value: 'hashtags', label: this.translate.instant('app.search.scope.hashtags') }
        ];
    }

    get progressItems(): readonly ProgressItem[] {
        return this.uploadProgress.items;
    }

    trackProgressItemById(_: number, item: ProgressItem): number {
        return item.id;
    }

    get noticeHistoryPreview(): readonly SessionNoticeEntry[] {
        return this.session.noticeHistory.slice(0, 6);
    }

    get showTopNoticeAction(): boolean {
        return this.appUpdateAvailable || this.isTopNoticeError;
    }

    get showMessagesDock(): boolean {
        return this.session.isAuthenticated() && !this.isChatRoute && !this.isMobileViewport;
    }

    get isMobileViewport(): boolean {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 780px)').matches;
    }

    get isChatRoute(): boolean {
        return this.router.url.startsWith('/chat');
    }

    get isEmbedRoute(): boolean {
        return /^\/embed\//i.test(this.router.url);
    }

    get isChatThreadRoute(): boolean {
        if (!this.isChatRoute) {
            return false;
        }

        const conversation = this.router.parseUrl(this.router.url).queryParamMap.get('conversation');
        return !!conversation?.trim();
    }

    get isCommunityPageRoute(): boolean {
        return /^\/c\//i.test(this.router.url)
            || /^\/cp\//i.test(this.router.url);
    }

    get isBlogReadingRoute(): boolean {
        const routePath = this.router.url.split('?')[0].split('#')[0].toLowerCase();
        const segments = routePath.split('/').filter(segment => !!segment);
        return segments.length >= 3 && segments[0] === 'blogs' && segments[1] !== 'studio';
    }

    get isSavedRoute(): boolean {
        const routePath = this.router.url.split('?')[0].split('#')[0].toLowerCase();
        return routePath === '/saved' || routePath.startsWith('/saved/');
    }

    get isSettingsRoute(): boolean {
        const routePath = this.router.url.split('?')[0].split('#')[0].toLowerCase();
        return routePath === '/settings' || routePath.startsWith('/settings/');
    }

    get isFeedRoute(): boolean {
        const routePath = this.router.url.split('?')[0].split('#')[0].toLowerCase();
        return routePath === '/feed' || routePath === '/';
    }

    get searchContextLabel(): string {
        return this.translate.instant(`app.search.context.${this.searchContextKey}`);
    }

    get searchPlaceholder(): string {
        if (this.manualSearchScope) {
            return this.getPlaceholderForScope(this.manualSearchScope);
        }

        switch (this.searchContextKey) {
            case 'communities':
                return this.translate.instant('app.search.placeholder.communities');
            case 'blogs':
                return this.translate.instant('app.search.placeholder.blogs');
            case 'profiles':
                return this.translate.instant('app.search.placeholder.profiles');
            case 'hashtags':
                return this.translate.instant('app.search.placeholder.hashtags');
            case 'chat':
                return this.translate.instant('app.search.placeholder.chat');
            case 'notifications':
                return this.translate.instant('app.search.placeholder.notifications');
            case 'discover':
                return this.translate.instant('app.search.placeholder.discover');
            default:
                return this.translate.instant('app.search.placeholder.global');
        }
    }

    get searchChipLabel(): string {
        return this.isSearchScopeOverridden
            ? `${this.translate.instant('app.search.scopePrefix')}: ${this.getScopeLabel(this.activeSearchScope)}`
            : this.searchContextLabel;
    }

    get isSearchScopeOverridden(): boolean {
        return this.manualSearchScope !== null;
    }

    get autoSearchScopeLabel(): string {
        return this.getScopeLabel(this.routeSearchDiscoverType);
    }

    private get updateNoticeMessage(): string {
        return this.translate.instant('app.notice.update');
    }

    private get searchContextKey(): 'communities' | 'blogs' | 'profiles' | 'hashtags' | 'chat' | 'notifications' | 'discover' | 'settings' | 'compose' | 'global' {
        const url = this.router.url.toLowerCase();

        if (/^\/(communities|c\/|cp\/)/.test(url)) {
            return 'communities';
        }

        if (/^\/blogs(\/|$)/.test(url)) {
            return 'blogs';
        }

        if (/^\/users\//.test(url) || /^\/profile(\/|$)/.test(url)) {
            return 'profiles';
        }

        if (/^\/hashtags\//.test(url)) {
            return 'hashtags';
        }

        if (/^\/chat(\/|$)/.test(url)) {
            return 'chat';
        }

        if (/^\/notifications(\/|$)/.test(url)) {
            return 'notifications';
        }

        if (/^\/discover(\/|$)/.test(url)) {
            return 'discover';
        }

        if (/^\/settings(\/|$)/.test(url)) {
            return 'settings';
        }

        if (/^\/compose(\/|$)/.test(url)) {
            return 'compose';
        }

        return 'global';
    }

    private get routeSearchDiscoverType(): SearchDiscoverType {
        switch (this.searchContextKey) {
            case 'communities':
                return 'communities';
            case 'blogs':
                return 'blogs';
            case 'profiles':
                return 'users';
            case 'hashtags':
                return 'hashtags';
            default:
                return 'all';
        }
    }

    private get activeSearchScope(): SearchDiscoverType {
        return this.manualSearchScope ?? this.routeSearchDiscoverType;
    }

    get canEditRightRailCommunityRules(): boolean {
        if (!this.rightRailCommunity || !this.session.isAuthenticated()) {
            return false;
        }

        const role = (this.rightRailCommunity.myRole ?? '').trim().toLowerCase();
        if (role === 'owner' || role === 'admin') {
            return true;
        }

        const currentProfileId = this.session.profile?.id;
        return !!currentProfileId && currentProfileId === this.rightRailCommunity.createdByProfileId;
    }

    ngOnInit(): void {
        this.applyThemePreference();
        this.applyE2EUpdateNoticeOverrides();
        this.initializeVersionUpdates();
        void this.updateRouteMetaAsync(this.router.url);
        void this.syncNotificationsRealtimeConnectionAsync();

        this.notificationsRealtime.notificationCreated$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(notification => {
                const currentProfileId = this.session.profile?.id ?? null;
                if (currentProfileId && notification.recipientId === currentProfileId && !notification.isRead && !this.seenRealtimeNotificationIds.has(notification.id)) {
                    this.seenRealtimeNotificationIds.add(notification.id);
                    this.unreadNotificationsCount += 1;

                    if (this.seenRealtimeNotificationIds.size > 400) {
                        const first = this.seenRealtimeNotificationIds.values().next().value as string | undefined;
                        if (first) {
                            this.seenRealtimeNotificationIds.delete(first);
                        }
                    }
                }

                this.session.notifyNotificationsUpdated();
                this.cdr.detectChanges();
            });

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

                if (change === 'session') {
                    void this.syncNotificationsRealtimeConnectionAsync();
                }

                if ((change === 'profile' || change === 'posts' || change === 'session') && this.isCommunityPageRoute) {
                    void this.loadRightRailCommunityAsync();
                }
            });

        this.session.openSaveToCollectionModal$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(request => {
                if (this.saveToCollectionRequest) {
                    this.saveToCollectionRequest.resolve(false);
                }

                this.saveToCollectionRequest = request;
            });

        this.session.messageChanges$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                this.onTopNoticeMessageChanged();
            });

        this.appLanguage.languageChanges$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                this.cdr.detectChanges();
            });

        this.session.openReelInModal$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((request: OpenReelInModalRequest) => {
                const reel = request.reel;
                this.dockStoryGroup = null;
                this.dockStoryIndex = 0;
                this.dockReelModal = {
                    reelId: reel.id,
                    videoUrl: reel.videoUrl,
                    thumbnailUrl: reel.thumbnailUrl,
                    authorHandle: reel.authorHandle,
                    authorImageUrl: reel.authorImageUrl,
                    caption: reel.caption,
                    createdAtUtc: reel.createdAtUtc,
                    likeCount: reel.likeCount,
                    likedByMe: reel.likedByMe,
                    comments: [...reel.comments],
                    muted: true,
                    collectionId: request.collectionId,
                    savedItemId: request.savedItemId,
                    onRemoveFromCollection: request.onRemoveFromCollection
                };
                this.dockReelCommentDraft = '';
                this.submittingDockReelComment = false;
                this.togglingDockReelLike = false;
                this.removingDockReelFromCollection = false;
            });

        this.router.events
            .pipe(
                filter(event => event instanceof NavigationEnd),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                this.mobileFooterMenuOpen = false;
                void this.updateRouteMetaAsync(this.router.url);

                if (!this.session.isAuthenticated()) {
                    this.unreadNotificationsCount = 0;
                }

                if (this.session.isAuthenticated()) {
                    void this.loadUnreadNotificationsCountAsync();
                }

                void this.loadRightRailCommunityAsync();
            });

        void this.initializeAsync();
        this.startStoryStatusPolling();
        this.startUnreadNotificationsPolling();
    }

    ngOnDestroy(): void {
        void this.notificationsRealtime.disconnect();

        if (this.saveToCollectionRequest) {
            this.saveToCollectionRequest.resolve(false);
            this.saveToCollectionRequest = null;
        }

        if (this.storyStatusPollTimerId !== null) {
            window.clearInterval(this.storyStatusPollTimerId);
            this.storyStatusPollTimerId = null;
        }

        if (this.notificationsPollTimerId !== null) {
            window.clearInterval(this.notificationsPollTimerId);
            this.notificationsPollTimerId = null;
        }

        if (this.updateCheckTimerId !== null) {
            window.clearInterval(this.updateCheckTimerId);
            this.updateCheckTimerId = null;
        }

        this.clearTopNoticeAutoDismissTimer();
        this.clearTopNoticeHideTimer();
    }

    closeSaveToCollectionModal(): void {
        this.saveToCollectionRequest = null;
    }

    @HostListener('window:storage', ['$event'])
    onStorageChanged(event: StorageEvent): void {
        if (event.key !== this.prefsStorageKey) {
            return;
        }

        this.applyThemePreference();
        void this.appLanguage.applyStoredPreferenceAsync();
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;

        if (this.searchScopePickerOpen) {
            if (target?.closest('.search-scope-picker')) {
                return;
            }

            this.searchScopePickerOpen = false;
        }

        if (this.mobileFooterMenuOpen && !target?.closest('.mobile-footer-more')) {
            this.mobileFooterMenuOpen = false;
        }
    }

    @HostListener('document:keydown.escape')
    onDocumentEscape(): void {
        this.searchScopePickerOpen = false;
        this.mobileFooterMenuOpen = false;
    }

    toggleMobileFooterMenu(): void {
        this.mobileFooterMenuOpen = !this.mobileFooterMenuOpen;
    }

    async navigateMobileFooterAsync(route: string, event?: Event): Promise<void> {
        if (event?.type === 'click' && Date.now() - this.lastMobileFooterTouchNavigateAt < 700) {
            return;
        }

        if (event?.type === 'touchend') {
            this.lastMobileFooterTouchNavigateAt = Date.now();
        }

        this.mobileFooterMenuOpen = false;
        await this.router.navigateByUrl(route);
    }

    isMobileFooterRouteActive(route: string): boolean {
        const baseUrl = this.router.url.split('?')[0]?.split('#')[0] ?? '';
        return baseUrl === route || baseUrl.startsWith(`${route}/`);
    }

    closeMobileFooterMenu(): void {
        this.mobileFooterMenuOpen = false;
    }

    private async initializeAsync(): Promise<void> {
        await this.session.bootstrapAsync();
        await this.loadTrendingHashtags();
        await this.refreshProfileChipStoryStatus();
        await this.loadUnreadNotificationsCountAsync();
        await this.loadRightRailCommunityAsync();
    }

    private async loadRightRailCommunityAsync(): Promise<void> {
        const communityRouteMatch = this.router.url.match(/^\/c\/([^?#/]+)/i)
            ?? this.router.url.match(/^\/communities\/([^?#/]+)/i);
        const communitySlug = communityRouteMatch?.[1]?.trim();
        const sharedCommunityPostMatch = this.router.url.match(/^\/cp\/([^?#/]+)/i)
            ?? this.router.url.match(/^\/shared\/community-post\/([^?#/]+)/i);
        const postId = sharedCommunityPostMatch?.[1]?.trim();

        if (!communitySlug && !postId) {
            this.rightRailCommunity = null;
            this.loadingRightRailCommunity = false;
            return;
        }

        this.loadingRightRailCommunity = true;
        this.rightRailCommunity = null;

        try {
            if (communitySlug) {
                this.rightRailCommunity = await this.session.getCommunityBySlugAsync(communitySlug);
                return;
            }

            if (!postId) {
                this.rightRailCommunity = null;
                return;
            }

            const post = await firstValueFrom(this.api.getSharedCommunityPost(postId));
            this.rightRailCommunity = await this.session.getCommunityByIdAsync(post.communityId);
        } catch {
            this.rightRailCommunity = null;
        } finally {
            this.loadingRightRailCommunity = false;
        }
    }

    private async updateRouteMetaAsync(rawUrl: string): Promise<void> {
        const requestVersion = ++this.metaRequestVersion;
        const routePath = this.normalizeRoutePath(rawUrl);
        const currentUrl = this.absoluteUrl(routePath);

        this.applyRouteMeta({
            title: this.defaultMetaTitle,
            description: this.defaultMetaDescription,
            imageUrl: this.absoluteUrl(this.defaultMetaImagePath),
            type: 'website'
        }, currentUrl);

        let resolvedMeta: RoutePreviewMeta | null = null;
        try {
            resolvedMeta = await this.resolveRouteMetaAsync(routePath);
        } catch {
            resolvedMeta = null;
        }

        if (requestVersion !== this.metaRequestVersion || !resolvedMeta) {
            return;
        }

        this.applyRouteMeta(resolvedMeta, currentUrl);
    }

    private async resolveRouteMetaAsync(routePath: string): Promise<RoutePreviewMeta | null> {
        const profileMatch = routePath.match(/^\/users\/([^?#/]+)/i);
        if (profileMatch) {
            const profile = await firstValueFrom(this.api.getProfile(profileMatch[1]));
            const displayName = this.sanitizeMetaContent(profile.displayName, profile.handle);
            return {
                title: `${displayName} (@${profile.handle}) | Venli`,
                description: this.truncatePreviewText(profile.bio, 220) || `View @${profile.handle}'s profile on Venli.`,
                imageUrl: this.absoluteMediaUrl(profile.imageUrl),
                type: 'profile'
            };
        }

        if (/^\/profile(\/|$)/i.test(routePath)) {
            const currentProfile = this.session.profile;
            if (currentProfile) {
                const displayName = this.sanitizeMetaContent(currentProfile.displayName, currentProfile.handle);
                return {
                    title: `${displayName} (@${currentProfile.handle}) | Venli`,
                    description: this.truncatePreviewText(currentProfile.bio, 220) || 'Your profile on Venli.',
                    imageUrl: this.absoluteMediaUrl(currentProfile.imageUrl),
                    type: 'profile'
                };
            }

            return {
                title: 'Your profile | Venli',
                description: 'Manage your profile on Venli.',
                type: 'profile'
            };
        }

        const postMatch = routePath.match(/^\/post\/([^?#/]+)/i);
        if (postMatch) {
            const post = await firstValueFrom(this.api.getPublicPost(postMatch[1]));
            const content = this.truncatePreviewText(post.content, 200);
            return {
                title: `@${post.authorHandle} on Venli`,
                description: content || 'Shared post on Venli.',
                imageUrl: this.absoluteMediaUrl(post.imageUrls?.[0] || post.imageUrl || post.authorImageUrl),
                type: 'article'
            };
        }

        const communityPostMatch = routePath.match(/^\/cp\/([^?#/]+)/i);
        if (communityPostMatch) {
            const communityPost = await firstValueFrom(this.api.getSharedCommunityPost(communityPostMatch[1]));
            const headline = this.truncatePreviewText(communityPost.title || communityPost.content || communityPost.mediaContent || '', 160);
            return {
                title: headline || `Community post by @${communityPost.authorHandle}`,
                description: this.truncatePreviewText(communityPost.content || communityPost.mediaContent || communityPost.linkUrl || '', 220) || 'Shared community post on Venli.',
                imageUrl: this.absoluteMediaUrl(communityPost.imageUrls?.[0] || communityPost.imageUrl || communityPost.authorImageUrl),
                type: 'article'
            };
        }

        const reelMatch = routePath.match(/^\/reel\/([^?#/]+)/i);
        if (reelMatch) {
            const reel = await firstValueFrom(this.api.getPublicReel(reelMatch[1]));
            return {
                title: `Reel by @${reel.authorHandle}`,
                description: this.truncatePreviewText(reel.caption, 220) || 'Watch this reel on Venli.',
                imageUrl: this.absoluteMediaUrl(reel.thumbnailUrl || reel.authorImageUrl),
                type: 'video.other'
            };
        }

        const storyMatch = routePath.match(/^\/story\/([^?#/]+)/i);
        if (storyMatch) {
            const story = await firstValueFrom(this.api.getPublicStory(storyMatch[1]));
            return {
                title: `Story by @${story.authorHandle}`,
                description: this.truncatePreviewText(story.caption, 220) || 'View this story on Venli.',
                imageUrl: this.absoluteMediaUrl(story.mediaUrl || story.authorImageUrl),
                type: 'article'
            };
        }

        const communityMatch = routePath.match(/^\/c\/([^?#/]+)/i);
        if (communityMatch) {
            const community = await firstValueFrom(this.api.getCommunityBySlug(communityMatch[1], 20));
            return {
                title: `${community.name} | Venli Community`,
                description: this.truncatePreviewText(community.description, 220) || `Join ${community.name} on Venli.`,
                imageUrl: this.absoluteMediaUrl(community.imageUrl),
                type: 'website'
            };
        }

        const blogPostMatch = routePath.match(/^\/blogs\/([^?#/]+)\/([^?#/]+)\/([^?#/]+)/i);
        if (blogPostMatch) {
            const post = await firstValueFrom(this.api.getBlogPost(blogPostMatch[1], blogPostMatch[2], blogPostMatch[3]));
            return {
                title: `${post.title} | @${post.authorHandle}`,
                description: this.truncatePreviewText(post.excerpt || post.content, 220) || 'Read this blog post on Venli.',
                imageUrl: this.absoluteMediaUrl(post.coverImageUrl),
                type: 'article'
            };
        }

        const blogMatch = routePath.match(/^\/blogs\/([^?#/]+)\/([^?#/]+)/i);
        if (blogMatch) {
            const blog = await firstValueFrom(this.api.getBlogByAuthorAndSlug(blogMatch[1], blogMatch[2]));
            return {
                title: `${blog.title} | @${blog.ownerHandle}`,
                description: this.truncatePreviewText(blog.description, 220) || `Read @${blog.ownerHandle}'s blog on Venli.`,
                type: 'website'
            };
        }

        const authorBlogMatch = routePath.match(/^\/blogs\/([^?#/]+)/i);
        if (authorBlogMatch) {
            return {
                title: `@${authorBlogMatch[1]} blogs | Venli`,
                description: `Read and follow @${authorBlogMatch[1]}'s blogs on Venli.`,
                type: 'website'
            };
        }

        return null;
    }

    private applyRouteMeta(meta: RoutePreviewMeta, absoluteUrl: string): void {
        const title = this.sanitizeMetaContent(meta.title, this.defaultMetaTitle);
        const description = this.sanitizeMetaContent(meta.description, this.defaultMetaDescription);
        const imageUrl = this.absoluteMediaUrl(meta.imageUrl || this.defaultMetaImagePath);
        const type = meta.type || 'website';

        this.titleService.setTitle(title);

        this.metaService.updateTag({ name: 'description', content: description });
        this.metaService.updateTag({ property: 'og:title', content: title });
        this.metaService.updateTag({ property: 'og:description', content: description });
        this.metaService.updateTag({ property: 'og:type', content: type });
        this.metaService.updateTag({ property: 'og:url', content: absoluteUrl });
        this.metaService.updateTag({ property: 'og:site_name', content: 'Venli' });
        this.metaService.updateTag({ name: 'twitter:title', content: title });
        this.metaService.updateTag({ name: 'twitter:description', content: description });
        this.metaService.updateTag({ name: 'twitter:url', content: absoluteUrl });
        this.metaService.updateTag({ name: 'twitter:card', content: imageUrl ? 'summary_large_image' : 'summary' });

        this.setMetaTagWithOptionalValue('property', 'og:image', imageUrl);
        this.setMetaTagWithOptionalValue('name', 'twitter:image', imageUrl);
    }

    private setMetaTagWithOptionalValue(tagType: 'name' | 'property', tagKey: string, value?: string): void {
        if (!value) {
            this.metaService.removeTag(`${tagType}='${tagKey}'`);
            return;
        }

        this.metaService.updateTag({ [tagType]: tagKey, content: value });
    }

    private sanitizeMetaContent(value: string | null | undefined, fallback: string): string {
        const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
        return normalized || fallback;
    }

    private truncatePreviewText(value: string | null | undefined, maxLength: number): string {
        const normalized = this.sanitizeMetaContent(value, '');
        if (!normalized) {
            return '';
        }

        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
    }

    private normalizeRoutePath(rawUrl: string): string {
        const withoutHash = rawUrl.split('#')[0] ?? '';
        const withoutQuery = withoutHash.split('?')[0] ?? '';
        return withoutQuery || '/';
    }

    private absoluteUrl(pathOrUrl: string): string {
        const normalized = (pathOrUrl ?? '').trim();
        if (!normalized) {
            return window.location.origin;
        }

        try {
            return new URL(normalized, window.location.origin).toString();
        } catch {
            return window.location.origin;
        }
    }

    private absoluteMediaUrl(pathOrUrl?: string | null): string | undefined {
        const normalized = (pathOrUrl ?? '').trim();
        if (!normalized) {
            return undefined;
        }

        try {
            return new URL(normalized, window.location.origin).toString();
        } catch {
            return undefined;
        }
    }

    async saveRightRailRulesAsync(rules: CommunityRuleDto[]): Promise<void> {
        const community = this.rightRailCommunity;
        if (!community || !this.canEditRightRailCommunityRules || this.savingRightRailRules) {
            return;
        }

        const normalizedRules = rules
            .map(rule => ({
                text: (rule.text ?? '').trim(),
                description: rule.description?.trim() || undefined
            }))
            .filter(rule => !!rule.text);

        this.savingRightRailRules = true;
        try {
            const updated = await this.session.updateCommunityAsync(
                community.id,
                community.name,
                community.description ?? null,
                normalizedRules,
                community.imageUrl ?? null,
                community.isPrivate
            );

            const updatedRules = (updated.rules ?? [])
                .map(rule => ({
                    text: (rule.text ?? '').trim(),
                    description: rule.description?.trim() || undefined
                }))
                .filter(rule => !!rule.text);
            const requestedKey = normalizedRules.map(rule => `${rule.text}|${rule.description ?? ''}`).join('\n').toLowerCase();
            const updatedKey = updatedRules.map(rule => `${rule.text}|${rule.description ?? ''}`).join('\n').toLowerCase();

            if (requestedKey !== updatedKey) {
                this.session.message = 'Rules were not saved by the server. Please refresh API and try again.';
                return;
            }

            this.rightRailCommunity = updated;
            this.session.message = 'Community rules updated.';
        } catch {
            this.session.message = 'Unable to save community rules right now.';
        } finally {
            this.savingRightRailRules = false;
        }
    }

    private applyThemePreference(): void {
        const stored = localStorage.getItem(this.prefsStorageKey);
        if (!stored) {
            const prefersDark = this.prefersSystemDarkMode();
            document.documentElement.classList.toggle('theme-dark', prefersDark);
            localStorage.setItem(this.prefsStorageKey, JSON.stringify({
                compactFeed: false,
                useSystemTheme: true,
                darkMode: prefersDark,
                reducedMotion: false,
                largerText: false,
                highContrast: false,
                language: 'system'
            }));
            this.applyPresentationPreferences({
                reducedMotion: false,
                largerText: false,
                highContrast: false,
                language: 'system'
            });
            return;
        }

        try {
            const parsed = JSON.parse(stored) as {
                useSystemTheme?: boolean;
                darkMode?: boolean;
                reducedMotion?: boolean;
                largerText?: boolean;
                highContrast?: boolean;
                language?: string;
            };
            const useSystemTheme = parsed.useSystemTheme ?? true;
            const darkMode = useSystemTheme ? this.prefersSystemDarkMode() : !!parsed.darkMode;
            document.documentElement.classList.toggle('theme-dark', darkMode);
            this.applyPresentationPreferences(parsed);
        } catch {
            const prefersDark = this.prefersSystemDarkMode();
            document.documentElement.classList.toggle('theme-dark', prefersDark);
            localStorage.setItem(this.prefsStorageKey, JSON.stringify({
                compactFeed: false,
                useSystemTheme: true,
                darkMode: prefersDark,
                reducedMotion: false,
                largerText: false,
                highContrast: false,
                language: 'system'
            }));
            this.applyPresentationPreferences({
                reducedMotion: false,
                largerText: false,
                highContrast: false,
                language: 'system'
            });
        }
    }

    private applyPresentationPreferences(prefs: { reducedMotion?: boolean; largerText?: boolean; highContrast?: boolean; language?: string }): void {
        const root = document.documentElement;
        root.classList.toggle('prefers-reduced-motion', !!prefs.reducedMotion);
        root.classList.toggle('larger-text', !!prefs.largerText);
        root.classList.toggle('high-contrast', !!prefs.highContrast);
        this.appLanguage.applyDocumentLanguage(prefs.language ?? 'system');
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

        await this.router.navigate(['/discover'], { queryParams: { q: query, type: this.activeSearchScope } });
    }

    toggleSearchScopePicker(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.searchScopePickerOpen = !this.searchScopePickerOpen;
    }

    selectSearchScope(scope: SearchDiscoverType, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.manualSearchScope = scope;
        this.searchScopePickerOpen = false;
    }

    clearSearchScopeOverride(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.manualSearchScope = null;
        this.searchScopePickerOpen = false;
    }

    private getScopeLabel(scope: SearchDiscoverType): string {
        switch (scope) {
            case 'communities':
                return this.translate.instant('app.search.scope.communities');
            case 'community-posts':
                return this.translate.instant('app.search.scope.communityPosts');
            case 'blogs':
                return this.translate.instant('app.search.scope.blogs');
            case 'users':
                return this.translate.instant('app.search.scope.users');
            case 'posts':
                return this.translate.instant('app.search.scope.posts');
            case 'reels':
                return this.translate.instant('app.search.scope.reels');
            case 'hashtags':
                return this.translate.instant('app.search.scope.hashtags');
            default:
                return this.translate.instant('app.search.scope.all');
        }
    }

    private getPlaceholderForScope(scope: SearchDiscoverType): string {
        switch (scope) {
            case 'communities':
                return this.translate.instant('app.search.placeholderByScope.communities');
            case 'community-posts':
                return this.translate.instant('app.search.placeholderByScope.communityPosts');
            case 'blogs':
                return this.translate.instant('app.search.placeholderByScope.blogs');
            case 'users':
                return this.translate.instant('app.search.placeholderByScope.users');
            case 'posts':
                return this.translate.instant('app.search.placeholderByScope.posts');
            case 'reels':
                return this.translate.instant('app.search.placeholderByScope.reels');
            case 'hashtags':
                return this.translate.instant('app.search.placeholderByScope.hashtags');
            default:
                return this.translate.instant('app.search.placeholder.global');
        }
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
        if (this.appUpdateAvailable) {
            void this.reloadForUpdateAsync();
            return;
        }

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

        if (!this.showTopNotice || this.appUpdateAvailable || this.isErrorNotice(this.topNoticeMessage)) {
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

    private initializeVersionUpdates(): void {
        if (!this.swUpdate.isEnabled) {
            return;
        }

        this.swUpdate.versionUpdates
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(event => {
                this.onVersionEvent(event);
            });

        void this.checkForAppUpdateAsync();
        this.updateCheckTimerId = window.setInterval(() => {
            void this.checkForAppUpdateAsync();
        }, 5 * 60 * 1000);
    }

    private onVersionEvent(event: VersionEvent): void {
        if (event.type !== 'VERSION_READY') {
            return;
        }

        if (this.appUpdateAvailable) {
            return;
        }

        const hash = event.latestVersion.hash?.trim() ?? '';
        this.appUpdateVersionLabel = hash ? `build ${hash.slice(0, 8)}` : 'Update ready';
        this.appUpdateAvailable = true;
        this.session.message = this.updateNoticeMessage;
    }

    private async checkForAppUpdateAsync(): Promise<void> {
        if (!this.swUpdate.isEnabled || this.appUpdateAvailable) {
            return;
        }

        try {
            await this.swUpdate.checkForUpdate();
        } catch {
            // Keep this silent to avoid noisy non-critical notices.
        }
    }

    private async reloadForUpdateAsync(): Promise<void> {
        if (this.reloadingForUpdate) {
            return;
        }

        this.reloadingForUpdate = true;

        if (this.shouldSkipHardReloadForE2E()) {
            this.cdr.detectChanges();
            return;
        }

        try {
            if (this.swUpdate.isEnabled) {
                await this.swUpdate.activateUpdate();
            }
        } catch {
            // Fallback to hard reload below.
        }

        window.location.reload();
    }

    private applyE2EUpdateNoticeOverrides(): void {
        if (!isDevMode() || typeof window === 'undefined') {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get('e2eShowUpdateNotice') !== '1') {
            return;
        }

        this.appUpdateAvailable = true;
        this.appUpdateVersionLabel = 'build e2e';
        this.session.message = this.updateNoticeMessage;
    }

    private shouldSkipHardReloadForE2E(): boolean {
        if (!isDevMode() || typeof window === 'undefined') {
            return false;
        }

        const params = new URLSearchParams(window.location.search);
        return params.get('e2eNoReload') === '1';
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
        this.profileChipStoryViewerError = '';
        this.deletingProfileChipStory = false;
    }

    get canDeleteActiveProfileChipStory(): boolean {
        const story = this.activeProfileChipStory;
        const currentProfileId = this.session.profile?.id;
        const currentHandle = (this.session.profile?.handle ?? '').trim().toLowerCase();
        if (!story) {
            return false;
        }

        if (currentProfileId && story.authorId === currentProfileId) {
            return true;
        }

        return !!currentHandle && story.authorHandle.trim().toLowerCase() === currentHandle;
    }

    requestDeleteProfileChipStory(story: StoryDto): void {
        if (!this.canDeleteActiveProfileChipStory || this.deletingProfileChipStory) {
            return;
        }

        void this.deleteProfileChipStoryAsync(story);
    }

    private async deleteProfileChipStoryAsync(story: StoryDto): Promise<void> {
        if (!this.canDeleteActiveProfileChipStory || this.deletingProfileChipStory) {
            return;
        }

        this.deletingProfileChipStory = true;
        this.profileChipStoryViewerError = '';

        try {
            await this.session.deleteStoryAsync(story.id);
            this.removeProfileChipStoryLocally(story.id);
            await this.refreshProfileChipStoryStatus();
        } catch {
            this.profileChipStoryViewerError = 'Could not delete this story right now.';
        } finally {
            this.deletingProfileChipStory = false;
        }
    }

    private removeProfileChipStoryLocally(storyId: string): void {
        const group = this.profileChipStoryGroup;
        if (!group) {
            return;
        }

        const updatedStories = group.stories.filter(story => story.id !== storyId);
        if (!updatedStories.length) {
            this.closeProfileChipStoryViewer();
            this.profileChipHasStory = false;
            this.profileChipHasUnseenStory = false;
            this.profileChipFirstStoryId = null;
            return;
        }

        this.profileChipStoryIndex = Math.min(this.profileChipStoryIndex, updatedStories.length - 1);
        this.profileChipStoryGroup = {
            ...group,
            stories: updatedStories,
            hasUnseenStories: updatedStories.some(story => !story.viewedByMe)
        };
        this.profileChipHasStory = true;
        this.profileChipHasUnseenStory = this.hasUnseenStories(this.profileChipStoryGroup);
        this.profileChipFirstStoryId = updatedStories[0]?.id ?? null;
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
        this.removingDockReelFromCollection = false;
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

    get canRemoveDockReelFromCollection(): boolean {
        return !!this.dockReelModal?.onRemoveFromCollection && !this.removingDockReelFromCollection;
    }

    async removeDockReelFromCollectionAsync(): Promise<void> {
        const onRemove = this.dockReelModal?.onRemoveFromCollection;
        if (!onRemove || this.removingDockReelFromCollection) {
            return;
        }

        this.removingDockReelFromCollection = true;
        try {
            const removed = await onRemove();
            if (removed) {
                this.closeDockReelModal();
            }
        } catch {
            this.session.message = 'Failed to remove from collection.';
        } finally {
            this.removingDockReelFromCollection = false;
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
            const trending = await this.session.loadTrendingHashtagsAsync(20);
            this.trendingHashtags = trending
                .map(item => ({ tag: item.tag.trim(), count: Math.max(0, item.count) }))
                .filter(item => item.tag.length > 0)
                .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
                .slice(0, 3);
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

    private startUnreadNotificationsPolling(): void {
        if (this.notificationsPollTimerId !== null) {
            return;
        }

        this.notificationsPollTimerId = window.setInterval(() => {
            if (!this.session.isAuthenticated() || document.hidden) {
                return;
            }

            void this.loadUnreadNotificationsCountAsync();
        }, 5000);
    }

    private async syncNotificationsRealtimeConnectionAsync(): Promise<void> {
        if (this.session.isAuthenticated()) {
            await this.notificationsRealtime.connect();
            return;
        }

        await this.notificationsRealtime.disconnect();
    }
}
