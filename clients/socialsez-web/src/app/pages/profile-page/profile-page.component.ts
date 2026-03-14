import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { CreatorAnalyticsSummaryDto, CreatorReelAnalyticsItemDto, PostDto, ProfileActivitySummaryDto, ProfileDto, ReelDto, StoryCollectionDto, StoryDto, StoryGroupDto } from '../../core/api.types';
import { executePostShareAction, executePostShareToChat, executePostShareToFeedAndReload } from '../../core/post-share-execution.utils';
import { PostInteractionsService } from '../../core/post-interactions.service';
import { cancelPostShareModal, openPostShareModal } from '../../core/post-share-modal-state.utils';
import { ReelInteractionsService } from '../../core/reel-interactions.service';
import { executeReelShareToChat } from '../../core/reel-share-to-chat.utils';
import { cancelReelShareModal, openReelShareModal } from '../../core/reel-share-modal-state.utils';
import { StoryPresenceService } from '../../core/story-presence.service';
import { buildUnfurlShareUrl } from '../../core/unfurl-link.util';
import { SessionService } from '../../core/session.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { PostComposerComponent } from '../../shared/post-composer/post-composer.component';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { ShareReelMessageModalComponent, ShareReelMessageSubmit } from '../../shared/share-reel-message-modal/share-reel-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { FeedReelsListComponent, ReelCommentCreateEvent, ReelCommentDeleteEvent, ReelCommentUpdateEvent } from '../feed-page/feed-reels-list.component';
import { FeedStoryViewerComponent } from '../feed-page/feed-story-viewer.component';
import { ReelComposerModalComponent } from '../../shared/reel-composer-modal/reel-composer-modal.component';
import { ReportModalComponent } from '../../shared/report-modal/report-modal.component';
import { SegmentedTabItem, SegmentedTabsComponent } from '../../shared/segmented-tabs/segmented-tabs.component';
import { CreateContentMenuComponent } from '../../shared/create-content-menu/create-content-menu.component';
import { buildSharedPostReferenceCounts } from '../../core/shared-post.utils';
import { UploadProgressService } from '../../core/upload-progress.service';

interface StoryTrimPreviewOption {
    previewUrl: string;
}

interface BioSegment {
    text: string;
    url?: string;
}

type ProfileContentReportTarget =
    | { kind: 'post'; id: string; handle: string }
    | { kind: 'reel'; id: string; handle: string }
    | { kind: 'story'; id: string; handle: string }
    | { kind: 'comment'; id: string; handle: string }
    | { kind: 'reel-comment'; id: string; handle: string };

@Component({
    selector: 'app-profile-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, ConfirmModalComponent, PostCardComponent, PostComposerComponent, SharePostModalComponent, SharePostMessageModalComponent, ShareReelMessageModalComponent, SkeletonComponent, FeedReelsListComponent, FeedStoryViewerComponent, ReelComposerModalComponent, ReportModalComponent, SegmentedTabsComponent, CreateContentMenuComponent],
    templateUrl: './profile-page.component.html',
    styleUrl: './profile-page.component.scss'
})
export class ProfilePageComponent implements OnDestroy {
    private static readonly StoryFrameOffsetLimit = 50;
    private static readonly StoryCropFrameHeightPercent = 100;
    private static readonly StoryOutputAspect = 9 / 16;
    private static readonly StoryMaxTrimDurationSeconds = 60;
    private static readonly ComposerCloseAnimationDurationMs = 180;

    @ViewChild('storyPreviewVideo') private readonly storyPreviewVideoRef?: ElementRef<HTMLVideoElement>;

    activeTab: 'posts' | 'reels' | 'analytics' = 'posts';
    private readonly ownContentTabs: readonly SegmentedTabItem[] = [
        { id: 'posts', label: 'Posts' },
        { id: 'reels', label: 'Reels' },
        { id: 'analytics', label: 'Analytics' }
    ];
    private readonly guestContentTabs: readonly SegmentedTabItem[] = [
        { id: 'posts', label: 'Posts' },
        { id: 'reels', label: 'Reels' }
    ];
    posts: PostDto[] = [];
    reels: ReelDto[] = [];
    loading = true;
    error = '';
    avatarImageUrl = '';
    editingPostId: string | null = null;
    editContent = '';
    savingPost = false;
    deletingPostId: string | null = null;
    pendingDeletePostId: string | null = null;
    reactingPostId: string | null = null;
    reactingReelId: string | null = null;
    commentingReelId: string | null = null;
    updatingReelId: string | null = null;
    deletingReelId: string | null = null;
    pendingDeleteReelId: string | null = null;
    deletingReelCommentId: string | null = null;
    pendingDeleteReelComment: { reelId: string; commentId: string } | null = null;
    showComposer = false;
    composerClosing = false;
    showStoryComposer = false;
    storyComposerClosing = false;
    storyComposerStep: 1 | 2 = 1;
    showReelComposer = false;
    createMenuOpen = false;
    storyMediaFile: File | null = null;
    storyMediaPreviewUrl = '';
    storyMediaIsVideo = false;
    storyMediaDurationSeconds = 0;
    storyTrimStartSeconds = 0;
    storyTrimEndSeconds = 0;
    storyTrimPreviewOptions: StoryTrimPreviewOption[] = [];
    generatingStoryTrimPreviews = false;
    storyPreviewReady = false;
    storySourceMediaWidth = 0;
    storySourceMediaHeight = 0;
    storyFrameZoom = 1;
    storyFrameOffsetX = 0;
    storyFrameOffsetY = 0;
    storyComposerError = '';
    postingStory = false;
    markStorySensitive = false;
    storyScheduledPublishLocal = '';
    sharingPostId: string | null = null;
    sharingReelId: string | null = null;
    pendingSharePost: PostDto | null = null;
    pendingShareReel: ReelDto | null = null;
    pendingShareTarget: 'feed' | 'chat' | null = null;
    shareNote = '';
    profileLinkCopied = false;
    viewedProfile: ProfileDto | null = null;
    viewedHandle: string | null = null;
    followState: 'idle' | 'loading' | 'success' | 'failure' = 'idle';
    isFollowing = false;
    isRequested = false;
    followRequiresApproval = false;
    profileSafetyMenuOpen = false;
    isBlocked = false;
    isBlockedByTarget = false;
    isMuted = false;
    blockingProfile = false;
    mutingProfile = false;
    reportingProfile = false;
    showReportModal = false;
    reportingContent = false;
    showContentReportModal = false;
    pendingContentReportTarget: ProfileContentReportTarget | null = null;
    showBlockModal = false;
    viewedProfileHasActiveStory = false;
    viewedProfileHasUnseenStory = false;
    activeStoryGroup: StoryGroupDto | null = null;
    activeStoryIndex = 0;
    storyCollections: StoryCollectionDto[] = [];
    storyArchive: StoryDto[] = [];
    newStoryCollectionName = '';
    selectedStoryCollectionId = '';
    creatingStoryCollection = false;
    addingStoryToCollection = false;
    loadingStoryCollections = false;
    showStoryCollectionCreateModal = false;
    showStoryCollectionAddModal = false;
    storyViewerError = '';
    sendingStoryReply = false;
    sharingStoryMessage = false;
    deletingStory = false;
    pendingDeleteStoryId: string | null = null;
    deletingStoryCollection = false;
    pendingDeleteStoryCollectionId: string | null = null;
    activitySummary: ProfileActivitySummaryDto | null = null;
    creatorAnalytics: CreatorAnalyticsSummaryDto | null = null;
    creatorAnalyticsError = '';
    loadingCreatorAnalytics = false;
    private loadInFlight = false;
    private reloadQueued = false;
    private hasLoadedProfileOnce = false;
    private lastLoadedProfileKey: string | null = null;
    private pendingOpenStoryFromQuery = false;
    private followStateResetTimerId: number | null = null;
    private readonly likedStoryIds = new Set<string>();
    private profileLinkCopiedResetTimerId: number | null = null;
    private composerCloseTimerId: number | null = null;
    private storyComposerCloseTimerId: number | null = null;
    private storyMediaObjectUrl = '';
    private markingStoryId: string | null = null;
    private activeStoryCollectionId: string | null = null;
    private pendingStoryIdForCollectionAdd: string | null = null;
    private readonly selectedStoryIdsForNewCollection = new Set<string>();
    private draggingStoryFrame = false;
    private storyFrameDragOriginClientX = 0;
    private storyFrameDragOriginClientY = 0;
    private storyFrameDragOriginOffsetX = 0;
    private storyFrameDragOriginOffsetY = 0;
    private storyFrameDragViewportWidth = 1;
    private storyFrameDragViewportHeight = 1;
    private draggingStoryTrimPart: 'start' | 'end' | 'range' | null = null;
    private storyTrimDragOriginClientX = 0;
    private storyTrimDragOriginStartSeconds = 0;
    private storyTrimDragOriginEndSeconds = 0;
    private storyTrimDragTrackWidth = 1;
    private storyTrimPreviewRefreshToken = 0;
    private readonly onGlobalStoryTrimPointerMove = (event: PointerEvent) => {
        this.handleStoryTrimPointerMove(event);
    };
    private readonly onGlobalStoryTrimPointerUp = () => {
        this.stopStoryTrimDragging();
    };
    private readonly onStoryFramePointerMove = (event: PointerEvent) => {
        this.handleStoryFramePointerMove(event);
    };
    private readonly onStoryFramePointerUp = () => {
        this.stopStoryFrameDragging();
    };
    private readonly ngZone = inject(NgZone);
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly destroyRef = inject(DestroyRef);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private lastBioPointerNavigationAt = 0;
    private repostCountSource: PostDto[] | null = null;
    private repostCountsByPostId = new Map<string, number>();

    constructor(
        public readonly session: SessionService,
        private readonly postInteractions: PostInteractionsService,
        private readonly reelInteractions: ReelInteractionsService,
        private readonly storyPresence: StoryPresenceService,
        private readonly route: ActivatedRoute,
        private readonly router: Router,
        private readonly uploadProgress: UploadProgressService
    ) {
        this.session.appChanges$
            .pipe(
                filter(change => change === 'posts' || change === 'profile' || change === 'session'),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                void this.load();
            });

        this.route.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const rawHandle = params.get('handle');
                this.viewedHandle = rawHandle ? rawHandle.trim().toLowerCase() : null;
                void this.load();
            });

        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const shouldOpenStory = (params.get('story') ?? '').trim() === '1';
                if (!shouldOpenStory) {
                    return;
                }

                this.pendingOpenStoryFromQuery = true;
                void this.tryOpenPendingOwnStoryFromQuery();
            });

        void this.load();
    }

    get profile(): ProfileDto | null {
        return this.viewedProfile;
    }

    get currentProfileId(): string | null {
        return this.session.profile?.id ?? null;
    }

    get hideSensitiveMediaEnabled(): boolean {
        return this.session.getHideSensitiveMediaPreference();
    }

    get isOwnProfile(): boolean {
        if (!this.viewedProfile || !this.currentProfileId) {
            return false;
        }

        return this.viewedProfile.id === this.currentProfileId;
    }

    get followButtonLabel(): string {
        if (this.followState === 'loading') {
            return 'Working...';
        }

        if (this.isBlockedView) {
            return 'Blocked';
        }

        if (this.followState === 'success') {
            if (this.isRequested) {
                return 'Request Sent';
            }

            return this.isFollowing ? 'Following' : 'Unfollowed';
        }

        if (this.followState === 'failure') {
            return 'Try again';
        }

        if (this.isRequested) {
            return 'Cancel Request';
        }

        return this.isFollowing ? 'Unfollow' : 'Follow';
    }

    renderBioHtml(bio: string): string {
        const source = (bio ?? '').trim();
        if (!source) {
            return '';
        }

        const decoded = this.decodeHtmlEntities(source);
        if (/<\/?[a-z][\s\S]*>/i.test(decoded)) {
            return this.normalizeBioHtmlLinks(decoded);
        }

        return this.linkifyBioText(source);
    }

    parseBioSegments(bio: string): BioSegment[] {
        const source = this.toDisplayBioText(bio ?? '');
        if (!source.trim()) {
            return [];
        }

        const expression = /((?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[^\s]*)?)/gi;
        const segments: BioSegment[] = [];
        let cursor = 0;

        for (const match of source.matchAll(expression)) {
            const value = match[0] ?? '';
            const index = match.index ?? 0;
            const cleanedValue = value.replace(/[),.;!?]+$/g, '');
            const normalizedUrl = this.normalizeBioUrl(cleanedValue);

            if (index > cursor) {
                segments.push({ text: source.slice(cursor, index) });
            }

            if (normalizedUrl) {
                segments.push({ text: cleanedValue, url: normalizedUrl });
                const trailingPart = value.slice(cleanedValue.length);
                if (trailingPart) {
                    segments.push({ text: trailingPart });
                }
            } else {
                segments.push({ text: value });
            }

            cursor = index + value.length;
        }

        if (cursor < source.length) {
            segments.push({ text: source.slice(cursor) });
        }

        return segments.length ? segments : [{ text: source }];
    }

    private toDisplayBioText(source: string): string {
        if (!source || !source.trim()) {
            return '';
        }

        if (!/[<>]|&(?:amp|lt|gt|quot|#39);/i.test(source)) {
            return source;
        }

        if (typeof document !== 'undefined') {
            const container = document.createElement('div');
            container.innerHTML = source;
            return (container.textContent ?? '')
                .replace(/\u00a0/g, ' ')
                .replace(/\r/g, '');
        }

        return source
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }

    private decodeHtmlEntities(source: string): string {
        if (!source) {
            return '';
        }

        if (typeof document !== 'undefined') {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = source;
            return textarea.value;
        }

        return source
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }

    private normalizeBioHtmlLinks(source: string): string {
        if (!source) {
            return '';
        }

        if (typeof document !== 'undefined') {
            const container = document.createElement('div');
            container.innerHTML = source;

            const links = container.querySelectorAll('a[href]');
            for (const link of links) {
                const target = (link.getAttribute('target') ?? '').trim();
                if (!target) {
                    link.setAttribute('target', '_self');
                }

                if ((link.getAttribute('target') ?? '').trim().toLowerCase() === '_blank') {
                    const rel = link.getAttribute('rel') ?? '';
                    const relTokens = new Set(rel.split(/\s+/).filter(Boolean).map(token => token.toLowerCase()));
                    relTokens.add('noopener');
                    relTokens.add('noreferrer');
                    link.setAttribute('rel', Array.from(relTokens).join(' '));
                }

                link.classList.add('bio-link');
            }

            return container.innerHTML;
        }

        return source;
    }

    private linkifyBioText(source: string): string {
        const expression = /((?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[^\s]*)?)/gi;
        let cursor = 0;
        let html = '';

        for (const match of source.matchAll(expression)) {
            const value = match[0] ?? '';
            const index = match.index ?? 0;
            const cleanedValue = value.replace(/[),.;!?]+$/g, '');
            const normalizedUrl = this.normalizeBioUrl(cleanedValue);

            if (index > cursor) {
                html += this.escapeHtml(source.slice(cursor, index));
            }

            if (normalizedUrl) {
                html += `<a class="bio-link" href="${this.escapeHtml(normalizedUrl)}" target="_self">${this.escapeHtml(cleanedValue)}</a>`;
                const trailingPart = value.slice(cleanedValue.length);
                if (trailingPart) {
                    html += this.escapeHtml(trailingPart);
                }
            } else {
                html += this.escapeHtml(value);
            }

            cursor = index + value.length;
        }

        if (cursor < source.length) {
            html += this.escapeHtml(source.slice(cursor));
        }

        return html || this.escapeHtml(source);
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    openBioLink(url: string | undefined, event: MouseEvent): void {
        if (!url) {
            return;
        }

        if (Date.now() - this.lastBioPointerNavigationAt < 500) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.navigateToBioUrl(url, '_self');
    }

    private normalizeBioUrl(candidate: string): string | null {
        const value = candidate.trim();
        if (!value) {
            return null;
        }

        if (/^https?:\/\//i.test(value)) {
            return value;
        }

        if (/^www\./i.test(value)) {
            return `https://${value}`;
        }

        if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[^\s]*)?$/i.test(value)) {
            return `https://${value}`;
        }

        return null;
    }

    private getEventPath(event: Event): EventTarget[] {
        const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : null;
        if (Array.isArray(composedPath) && composedPath.length) {
            return composedPath;
        }

        const fallbackPath: EventTarget[] = [];
        let currentNode = event.target as Node | null;
        while (currentNode) {
            fallbackPath.push(currentNode);
            currentNode = currentNode.parentNode;
        }

        fallbackPath.push(window);
        return fallbackPath;
    }

    get isPrivateLockedView(): boolean {
        return !!this.viewedProfile
            && !this.isOwnProfile
            && this.viewedProfile.isPrivate
            && !this.isFollowing;
    }

    get isBlockedView(): boolean {
        return !!this.viewedProfile && !this.isOwnProfile && (this.isBlocked || this.isBlockedByTarget);
    }

    get blockedViewStatusMessage(): string {
        if (this.isBlockedByTarget) {
            return 'This profile blocked you. Posts, reels, stories, and bio are hidden.';
        }

        return 'You blocked this profile. Posts, reels, stories, and bio are hidden.';
    }

    get totalPosts(): number {
        return this.activitySummary?.postCount ?? this.posts.length;
    }

    get totalFollowers(): number {
        return this.activitySummary?.followerCount ?? 0;
    }

    get totalFollowing(): number {
        return this.activitySummary?.followingCount ?? 0;
    }

    get contentTabs(): readonly SegmentedTabItem[] {
        return this.isOwnProfile ? this.ownContentTabs : this.guestContentTabs;
    }

    get creatorAnalyticsWindowDays(): number {
        return this.creatorAnalytics?.days ?? 30;
    }

    get creatorAnalyticsTopReels(): CreatorReelAnalyticsItemDto[] {
        const reels = this.creatorAnalytics?.reels ?? [];
        return reels
            .slice()
            .sort((left, right) => right.views - left.views)
            .slice(0, 3);
    }

    formatFollowerGrowth(value: number): string {
        if (value === 0) {
            return '0';
        }

        const sign = value > 0 ? '+' : '';
        return `${sign}${value.toLocaleString()}`;
    }

    formatWatchTime(totalSeconds: number): string {
        if (totalSeconds <= 0) {
            return '0s';
        }

        const roundedSeconds = Math.round(totalSeconds);
        const hours = Math.floor(roundedSeconds / 3600);
        const minutes = Math.floor((roundedSeconds % 3600) / 60);
        const seconds = roundedSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }

        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }

        return `${seconds}s`;
    }

    get isEstablishedAccount(): boolean {
        const createdAt = this.viewedProfile?.createdAtUtc;
        if (!createdAt) {
            return false;
        }

        const createdAtMs = Date.parse(createdAt);
        if (Number.isNaN(createdAtMs)) {
            return false;
        }

        const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
        return ageDays >= 30;
    }

    get lastActivityAtUtc(): string | null {
        const timestamps = [
            ...this.posts.map(post => post.createdAtUtc),
            ...this.reels.map(reel => reel.createdAtUtc)
        ];

        let latestTimestamp: string | null = null;
        let latestMs = Number.NEGATIVE_INFINITY;

        for (const timestamp of timestamps) {
            const parsedMs = Date.parse(timestamp);
            if (Number.isNaN(parsedMs) || parsedMs <= latestMs) {
                continue;
            }

            latestMs = parsedMs;
            latestTimestamp = timestamp;
        }

        return latestTimestamp;
    }

    get activeStoryAuthorHandles(): string[] {
        return this.storyPresence.getActiveStoryAuthorHandles(this.viewedProfileStoryPresenceGroups);
    }

    get activeUnseenStoryAuthorHandles(): string[] {
        return this.storyPresence.getUnseenStoryAuthorHandles(this.viewedProfileStoryPresenceGroups);
    }

    get currentProfileHandle(): string | null {
        return this.viewedProfile?.handle?.trim().toLowerCase() ?? null;
    }

    get activeStory(): StoryDto | null {
        if (!this.activeStoryGroup) {
            return null;
        }

        return this.activeStoryGroup.stories[this.activeStoryIndex] ?? null;
    }

    get hasPreviousStory(): boolean {
        return this.activeStoryIndex > 0;
    }

    get hasNextStory(): boolean {
        return !!this.activeStoryGroup && this.activeStoryIndex < this.activeStoryGroup.stories.length - 1;
    }

    get savedReelIds(): string[] {
        return Array.from(this.session.savedReelIds.keys());
    }

    get hasPendingStoryUpload(): boolean {
        return this.uploadProgress.items.some(item => item.status === 'pending' && item.kind === 'story');
    }

    get storyUploadInProgress(): boolean {
        return this.postingStory || this.hasPendingStoryUpload;
    }

    get canDeleteActiveStory(): boolean {
        if (this.activeStoryCollectionId) {
            return false;
        }

        const story = this.activeStory;
        return !!story && !!this.currentProfileId && story.authorId === this.currentProfileId;
    }

    get canReportActiveStory(): boolean {
        if (this.activeStoryCollectionId) {
            return false;
        }

        const story = this.activeStory;
        return !!story && !!this.currentProfileId && story.authorId !== this.currentProfileId;
    }

    get canCreateStoryCollection(): boolean {
        return this.isOwnProfile && !!this.newStoryCollectionName.trim() && !this.creatingStoryCollection;
    }

    get hasSelectedStoriesForNewCollection(): boolean {
        return this.selectedStoryIdsForNewCollection.size > 0;
    }

    get showStoryCollectionsSection(): boolean {
        if (this.isBlockedView) {
            return false;
        }

        return this.isOwnProfile || this.storyCollections.length > 0;
    }

    get canAddStoriesToCollection(): boolean {
        return this.isOwnProfile
            && !this.addingStoryToCollection
            && !!this.selectedStoryCollectionId;
    }

    get selectedStoryCollection(): StoryCollectionDto | null {
        return this.storyCollections.find(item => item.id === this.selectedStoryCollectionId) ?? null;
    }

    get canSaveActiveStoryToCollection(): boolean {
        const story = this.activeStory;
        return !!story && this.isOwnProfile && story.authorId === this.currentProfileId && !this.addingStoryToCollection;
    }

    get isActiveStorySavedToCollection(): boolean {
        const storyId = this.activeStory?.id?.trim();
        if (!storyId) {
            return false;
        }

        return this.storyCollections.some(collection => collection.stories.some(story => story.id === storyId));
    }

    get deleteSelectedStoryCollectionMessage(): string {
        const pendingId = this.pendingDeleteStoryCollectionId;
        const collectionName = this.storyCollections.find(collection => collection.id === pendingId)?.name
            ?? this.selectedStoryCollection?.name
            ?? 'this collection';
        return `Delete "${collectionName}"? Stories will stay in your archive.`;
    }

    getStoryCollectionCoverUrl(collection: StoryCollectionDto): string | null {
        return collection.stories[0]?.mediaUrl?.trim() || collection.coverMediaUrl?.trim() || null;
    }

    isStoryCollectionVideoCover(mediaUrl?: string | null): boolean {
        if (!mediaUrl) {
            return false;
        }

        return /\.(mp4|webm|mov|m4v|ogg)(?:$|[?#])/i.test(mediaUrl);
    }

    async copyProfileLinkAsync(): Promise<void> {
        const handle = this.viewedProfile?.handle?.trim().toLowerCase();
        if (!handle) {
            return;
        }

        const link = buildUnfurlShareUrl(`/users/${handle}`);

        try {
            await navigator.clipboard.writeText(link);
            this.ngZone.run(() => {
                this.profileLinkCopied = true;
                if (this.profileLinkCopiedResetTimerId !== null) {
                    window.clearTimeout(this.profileLinkCopiedResetTimerId);
                }

                this.profileLinkCopiedResetTimerId = window.setTimeout(() => {
                    this.ngZone.run(() => {
                        this.profileLinkCopied = false;
                        this.profileLinkCopiedResetTimerId = null;
                    });
                }, 2000);
            });
        } catch {
            this.ngZone.run(() => {
                this.error = 'Could not copy profile link right now.';
            });
        }
    }

    setActiveTab(tab: 'posts' | 'reels' | 'analytics'): void {
        this.activeTab = tab;
    }

    onActiveTabChanged(tabId: string): void {
        if (tabId !== 'posts' && tabId !== 'reels' && tabId !== 'analytics') {
            return;
        }

        if (tabId === 'analytics' && !this.isOwnProfile) {
            return;
        }

        this.setActiveTab(tabId);
    }

    openComposer(): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.ngZone.run(() => {
            this.createMenuOpen = false;
            if (this.storyComposerCloseTimerId !== null) {
                window.clearTimeout(this.storyComposerCloseTimerId);
                this.storyComposerCloseTimerId = null;
            }
            this.storyComposerClosing = false;
            this.showStoryComposer = false;
            this.showReelComposer = false;
            if (this.composerCloseTimerId !== null) {
                window.clearTimeout(this.composerCloseTimerId);
                this.composerCloseTimerId = null;
            }
            this.composerClosing = false;
            this.showComposer = true;
            this.cdr.detectChanges();
        });
    }

    toggleCreateMenu(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.createMenuOpen = !this.createMenuOpen;
        this.cdr.detectChanges();
    }

    closeCreateMenu(): void {
        this.createMenuOpen = false;
    }

    toggleProfileSafetyMenu(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.profileSafetyMenuOpen = !this.profileSafetyMenuOpen;
        this.cdr.detectChanges();
    }

    closeProfileSafetyMenu(): void {
        this.profileSafetyMenuOpen = false;
        this.cdr.detectChanges();
    }

    onSafetyActionSelected(action: 'mute' | 'block' | 'report'): void {
        this.closeProfileSafetyMenu();

        if (action === 'mute') {
            void this.toggleMuteProfile();
            return;
        }

        if (action === 'block') {
            if (this.isBlocked) {
                void this.toggleBlockProfile();
            } else {
                this.openBlockModal();
            }
            return;
        }

        this.openReportModal();
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        let shouldDetectChanges = false;

        const clickedInsideCreateMenu = this.getEventPath(event).some((node) => {
            return node instanceof HTMLElement && node.classList.contains('hero-create-menu');
        });

        if (this.createMenuOpen && !clickedInsideCreateMenu) {
            this.createMenuOpen = false;
            shouldDetectChanges = true;
        }

        const clickedInsideSafetyMenu = this.getEventPath(event).some((node) => {
            return node instanceof HTMLElement && node.classList.contains('profile-safety-menu');
        });

        if (this.profileSafetyMenuOpen && !clickedInsideSafetyMenu) {
            this.profileSafetyMenuOpen = false;
            shouldDetectChanges = true;
        }

        if (shouldDetectChanges) {
            this.cdr.detectChanges();
        }
    }

    @HostListener('document:pointerdown', ['$event'])
    onDocumentPointerDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }

        const eventTarget = event.target as HTMLElement | null;
        const bioLink = eventTarget?.closest('a.bio-link') as HTMLAnchorElement | null;
        if (!bioLink) {
            return;
        }

        if (!this.hostElement.nativeElement.contains(bioLink)) {
            return;
        }

        const href = bioLink.href?.trim();
        if (!href) {
            return;
        }

        const linkTarget = (bioLink.getAttribute('target') ?? '_self').trim() || '_self';
        const rel = bioLink.getAttribute('rel') ?? undefined;

        event.preventDefault();
        event.stopPropagation();
        this.lastBioPointerNavigationAt = Date.now();
        this.navigateToBioUrl(href, linkTarget, rel);
    }

    private navigateToBioUrl(url: string, target: string = '_self', rel?: string): void {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = target;

        if (target.toLowerCase() === '_blank') {
            const relTokens = new Set((rel ?? '').split(/\s+/).filter(Boolean).map(token => token.toLowerCase()));
            relTokens.add('noopener');
            relTokens.add('noreferrer');
            anchor.rel = Array.from(relTokens).join(' ');
        } else if (rel?.trim()) {
            anchor.rel = rel;
        }

        anchor.style.display = 'none';

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }

    @HostListener('document:keydown.escape')
    onEscapePressed(): void {
        const hadOpenMenus = this.createMenuOpen || this.profileSafetyMenuOpen || this.showBlockModal;
        this.createMenuOpen = false;
        this.profileSafetyMenuOpen = false;
        this.showBlockModal = false;

        if (hadOpenMenus) {
            this.cdr.detectChanges();
        }
    }

    openStoryComposer(): void {
        if (!this.isOwnProfile) {
            return;
        }

        if (this.postingStory) {
            return;
        }

        this.ngZone.run(() => {
            this.createMenuOpen = false;
            if (this.composerCloseTimerId !== null) {
                window.clearTimeout(this.composerCloseTimerId);
                this.composerCloseTimerId = null;
            }
            this.composerClosing = false;
            this.showComposer = false;
            this.showReelComposer = false;
            if (this.storyComposerCloseTimerId !== null) {
                window.clearTimeout(this.storyComposerCloseTimerId);
                this.storyComposerCloseTimerId = null;
            }
            this.storyComposerClosing = false;
            this.showStoryComposer = true;
            this.storyComposerStep = 1;
            this.storyComposerError = '';
            this.cdr.detectChanges();
        });
    }

    openReelComposer(): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.ngZone.run(() => {
            this.createMenuOpen = false;
            this.showComposer = false;
            this.showStoryComposer = false;
            this.showReelComposer = true;
            this.cdr.detectChanges();
        });
    }

    openBlogStudio(): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.createMenuOpen = false;
        void this.router.navigate(['/blogs/studio']);
    }

    onReelComposerClosed(): void {
        this.showReelComposer = false;
    }

    onReelComposerPublished(): void {
        this.activeTab = 'reels';
        void this.load();
    }

    onPostComposerBackdropClick(event: MouseEvent): void {
        if (event.target !== event.currentTarget) {
            return;
        }

        this.onComposerCanceled();
    }

    onStoryComposerBackdropClick(event: MouseEvent): void {
        if (event.target !== event.currentTarget || this.postingStory) {
            return;
        }

        this.cancelStoryComposer();
    }

    onComposerCanceled(): void {
        this.beginPostComposerClose();
    }

    async onComposerPosted(): Promise<void> {
        this.beginPostComposerClose();
        await this.load();
    }

    cancelStoryComposer(): void {
        if (this.postingStory) {
            return;
        }

        this.beginStoryComposerClose();
    }

    private beginPostComposerClose(): void {
        if ((!this.showComposer && !this.composerClosing) || this.composerClosing) {
            return;
        }

        this.composerClosing = true;
        if (this.composerCloseTimerId !== null) {
            window.clearTimeout(this.composerCloseTimerId);
        }

        this.composerCloseTimerId = window.setTimeout(() => {
            this.showComposer = false;
            this.composerClosing = false;
            this.composerCloseTimerId = null;
        }, ProfilePageComponent.ComposerCloseAnimationDurationMs);
    }

    private beginStoryComposerClose(): void {
        if ((!this.showStoryComposer && !this.storyComposerClosing) || this.storyComposerClosing) {
            return;
        }

        this.storyComposerClosing = true;
        if (this.storyComposerCloseTimerId !== null) {
            window.clearTimeout(this.storyComposerCloseTimerId);
        }

        this.storyComposerCloseTimerId = window.setTimeout(() => {
            this.showStoryComposer = false;
            this.storyComposerClosing = false;
            this.storyComposerStep = 1;
            this.storyComposerError = '';
            this.clearStoryMediaSelection();
            this.storyComposerCloseTimerId = null;
        }, ProfilePageComponent.ComposerCloseAnimationDurationMs);
    }

    goToStoryComposerStep(step: 1 | 2): void {
        if (step === 2 && !this.storyMediaFile) {
            this.storyComposerError = 'Choose media first to continue.';
            return;
        }

        if (step === 2 && this.storyMediaIsVideo && !this.storyPreviewReady) {
            this.storyComposerError = 'Preparing preview controls. Please wait a moment.';
            return;
        }

        this.storyComposerError = '';
        this.storyComposerStep = step;
    }

    async onStoryMediaSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;

        this.clearStoryMediaSelection();

        if (file) {
            this.storyMediaFile = file;
            this.storyMediaPreviewUrl = URL.createObjectURL(file);
            this.storyMediaObjectUrl = this.storyMediaPreviewUrl;
            this.storyMediaIsVideo = file.type.startsWith('video/');
            this.storyPreviewReady = !this.storyMediaIsVideo;
            this.storyComposerError = '';

            if (this.storyMediaIsVideo) {
                try {
                    this.storyMediaDurationSeconds = await this.readVideoDurationSeconds(file);
                    this.storyTrimStartSeconds = 0;
                    this.storyTrimEndSeconds = Math.min(this.storyMediaDurationSeconds, ProfilePageComponent.StoryMaxTrimDurationSeconds);
                    void this.generateStoryTrimPreviewOptions(file, this.storyMediaDurationSeconds);
                } catch {
                    this.storyComposerError = 'Could not process this video. Please choose a different file.';
                    this.clearStoryMediaSelection();
                }
            }

            if (this.storyMediaFile) {
                this.storyComposerStep = 2;
            }
        }

        input.value = '';
    }

    onStoryPreviewLoadedMetadata(): void {
        const preview = this.storyPreviewVideoRef?.nativeElement;
        if (!preview) {
            return;
        }

        const parsedDuration = Number.isFinite(preview.duration) ? Math.round(preview.duration) : 0;
        if (parsedDuration > 0) {
            this.storyMediaDurationSeconds = parsedDuration;
            this.storyTrimStartSeconds = Math.max(0, Math.min(this.storyTrimStartSeconds, parsedDuration - 1));
            const defaultEnd = this.storyTrimEndSeconds || parsedDuration;
            const maxEnd = Math.min(parsedDuration, this.storyTrimStartSeconds + ProfilePageComponent.StoryMaxTrimDurationSeconds);
            this.storyTrimEndSeconds = Math.max(this.storyTrimStartSeconds + 1, Math.min(defaultEnd, maxEnd));
            if (this.storyTrimEndSeconds - this.storyTrimStartSeconds > ProfilePageComponent.StoryMaxTrimDurationSeconds) {
                this.storyTrimEndSeconds = Math.min(parsedDuration, this.storyTrimStartSeconds + ProfilePageComponent.StoryMaxTrimDurationSeconds);
            }
        }

        this.storySourceMediaWidth = preview.videoWidth || 0;
        this.storySourceMediaHeight = preview.videoHeight || 0;

        this.storyPreviewReady = true;
        this.syncStoryPreviewToTrimRange(true);
        void preview.play().catch(() => {
            // ignored: browser may still require a user gesture in some contexts
        });
    }

    onStoryPreviewTimeUpdate(): void {
        const preview = this.storyPreviewVideoRef?.nativeElement;
        if (!preview || !this.storyMediaIsVideo) {
            return;
        }

        if (preview.currentTime >= this.storyTrimEndSeconds) {
            preview.currentTime = this.storyTrimStartSeconds;
            if (!preview.paused) {
                void preview.play().catch(() => {
                    // ignored: user gesture may be required
                });
            }
        }
    }

    onStoryTrimStartChanged(rawValue: string): void {
        const next = Number(rawValue);
        if (Number.isNaN(next) || !this.storyMediaIsVideo) {
            return;
        }

        const minStart = Math.max(0, this.storyTrimEndSeconds - ProfilePageComponent.StoryMaxTrimDurationSeconds);
        this.storyTrimStartSeconds = Math.max(minStart, Math.min(next, this.storyTrimEndSeconds - 1));
        this.syncStoryPreviewToTrimRange();
    }

    onStoryTrimEndChanged(rawValue: string): void {
        const next = Number(rawValue);
        if (Number.isNaN(next) || !this.storyMediaIsVideo) {
            return;
        }

        const maxEnd = Math.min(this.storyMediaDurationSeconds, this.storyTrimStartSeconds + ProfilePageComponent.StoryMaxTrimDurationSeconds);
        this.storyTrimEndSeconds = Math.max(this.storyTrimStartSeconds + 1, Math.min(next, maxEnd));
        this.syncStoryPreviewToTrimRange();
    }

    get storyTrimmedDurationLabel(): string {
        return `${Math.max(1, Math.round(this.storyTrimEndSeconds - this.storyTrimStartSeconds))}s`;
    }

    get storyFrameTransform(): string {
        return `translate(${this.storyFrameOffsetX}%, ${this.storyFrameOffsetY}%) scale(${this.storyFrameZoom})`;
    }

    get storyCropFrameStyle(): Record<string, string> {
        const frameHeightPercent = ProfilePageComponent.StoryCropFrameHeightPercent;
        const frameWidthPercent = frameHeightPercent * (9 / 16) * (9 / 16);
        const maxCenterShiftX = Math.max(0, (100 - frameWidthPercent) / 2);
        const maxCenterShiftY = Math.max(0, (100 - frameHeightPercent) / 2);
        const offsetLimit = ProfilePageComponent.StoryFrameOffsetLimit;
        const shiftX = (this.storyFrameOffsetX / offsetLimit) * maxCenterShiftX;
        const shiftY = (this.storyFrameOffsetY / offsetLimit) * maxCenterShiftY;

        return {
            height: `${frameHeightPercent}%`,
            width: `${frameWidthPercent}%`,
            left: `${50 + shiftX}%`,
            top: `${50 + shiftY}%`
        };
    }

    get isStoryFrameDragging(): boolean {
        return this.draggingStoryFrame;
    }

    get storyTrimStartPercent(): number {
        if (this.storyMediaDurationSeconds <= 0) {
            return 0;
        }

        return (this.storyTrimStartSeconds / this.storyMediaDurationSeconds) * 100;
    }

    get storyTrimEndPercent(): number {
        if (this.storyMediaDurationSeconds <= 0) {
            return 100;
        }

        return (this.storyTrimEndSeconds / this.storyMediaDurationSeconds) * 100;
    }

    resetStoryFramePosition(): void {
        this.storyFrameZoom = 1;
        this.storyFrameOffsetX = 0;
        this.storyFrameOffsetY = 0;
    }

    onStoryFramePointerDown(event: PointerEvent, viewport: HTMLElement): void {
        if (!this.storyMediaFile) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.draggingStoryFrame = true;
        this.storyFrameDragOriginClientX = event.clientX;
        this.storyFrameDragOriginClientY = event.clientY;
        this.storyFrameDragOriginOffsetX = this.storyFrameOffsetX;
        this.storyFrameDragOriginOffsetY = this.storyFrameOffsetY;
        const bounds = viewport.getBoundingClientRect();
        this.storyFrameDragViewportWidth = Math.max(1, bounds.width);
        this.storyFrameDragViewportHeight = Math.max(1, bounds.height);
        this.attachStoryFrameDragListeners();
    }

    onStoryImageLoaded(event: Event): void {
        const image = event.target as HTMLImageElement;
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;

        if (!width || !height) {
            return;
        }

        this.storySourceMediaWidth = width;
        this.storySourceMediaHeight = height;
    }

    onStoryTrimHandlePointerDown(event: PointerEvent, part: 'start' | 'end', track: HTMLElement): void {
        if (this.storyMediaDurationSeconds <= 1 || this.postingStory) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.beginStoryTrimDragging(part, event.clientX, track);
    }

    onStoryTrimRangePointerDown(event: PointerEvent, track: HTMLElement): void {
        if (this.storyMediaDurationSeconds <= 1 || this.postingStory) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.beginStoryTrimDragging('range', event.clientX, track);
    }

    onStoryScheduledPublishChanged(value: string): void {
        this.storyScheduledPublishLocal = value;
    }

    async publishStory(saveAsDraft = false): Promise<void> {
        if (!this.storyMediaFile || this.postingStory) {
            return;
        }

        const scheduledPublishAtUtc = this.toScheduledPublishUtcIso(this.storyScheduledPublishLocal);

        this.postingStory = true;
        this.storyComposerError = '';
        const handle = this.uploadProgress.begin(saveAsDraft ? 'Saving story draft...' : scheduledPublishAtUtc ? 'Scheduling story...' : 'Uploading story...', 'story');

        this.showStoryComposer = false;
        this.storyComposerClosing = false;
        this.detachStoryFrameDragListeners();
        this.detachStoryTrimDragListeners();

        void (async () => {
            try {
                const uploadStoryMedia = await this.buildProcessedStoryMedia(this.storyMediaFile!);
                const storyThumbnail = await this.buildStoryThumbnailForUpload(uploadStoryMedia);
                const isSensitive = this.markStorySensitive;
                await this.session.createStoryAsync(uploadStoryMedia, undefined, isSensitive, storyThumbnail, saveAsDraft, scheduledPublishAtUtc ?? undefined);
                await this.load();
                handle.succeed(saveAsDraft ? 'Story draft saved!' : scheduledPublishAtUtc ? 'Story scheduled!' : 'Story published!');
            } catch {
                this.error = saveAsDraft ? 'Could not save story draft right now.' : 'Could not publish story right now.';
                handle.fail(saveAsDraft ? 'Story draft save failed' : 'Story upload failed');
            } finally {
                this.postingStory = false;
                this.storyComposerStep = 1;
                this.storyComposerError = '';
                this.clearStoryMediaSelection();
            }
        })();
    }

    ngOnDestroy(): void {
        if (this.profileLinkCopiedResetTimerId !== null) {
            window.clearTimeout(this.profileLinkCopiedResetTimerId);
            this.profileLinkCopiedResetTimerId = null;
        }

        if (this.composerCloseTimerId !== null) {
            window.clearTimeout(this.composerCloseTimerId);
            this.composerCloseTimerId = null;
        }

        if (this.storyComposerCloseTimerId !== null) {
            window.clearTimeout(this.storyComposerCloseTimerId);
            this.storyComposerCloseTimerId = null;
        }

        this.clearStoryMediaSelection();
    }

    async load(): Promise<void> {
        if (this.loadInFlight) {
            this.reloadQueued = true;
            return;
        }

        this.loadInFlight = true;

        try {
            do {
                this.reloadQueued = false;
                const currentProfileKey = this.viewedHandle ?? '__me__';
                const shouldShowSkeleton = !this.hasLoadedProfileOnce || this.lastLoadedProfileKey !== currentProfileKey;
                this.loading = shouldShowSkeleton;
                this.error = '';

                try {
                    if (!this.viewedHandle && !this.session.profile) {
                        await this.session.refreshMeAsync();
                    }

                    let profile: ProfileDto | null = null;

                    try {
                        profile = this.viewedHandle
                            ? await this.session.loadPublicProfileAsync(this.viewedHandle)
                            : this.session.profile;
                    } catch {
                        profile = null;
                    }

                    if (!profile) {
                        this.error = this.viewedHandle ? 'Could not load this profile.' : 'Could not load your profile.';
                        this.viewedProfile = null;
                        this.posts = [];
                        this.activitySummary = null;
                        this.creatorAnalytics = null;
                        this.creatorAnalyticsError = '';
                        this.loadingCreatorAnalytics = false;
                        continue;
                    }

                    this.viewedProfile = profile;
                    if (!this.isOwnProfile && this.activeTab === 'analytics') {
                        this.activeTab = 'posts';
                    }
                    this.hasLoadedProfileOnce = true;
                    this.lastLoadedProfileKey = currentProfileKey;
                    this.showComposer = false;
                    this.composerClosing = false;
                    this.showStoryComposer = false;
                    this.storyComposerClosing = false;
                    this.showReelComposer = false;
                    if (this.composerCloseTimerId !== null) {
                        window.clearTimeout(this.composerCloseTimerId);
                        this.composerCloseTimerId = null;
                    }
                    if (this.storyComposerCloseTimerId !== null) {
                        window.clearTimeout(this.storyComposerCloseTimerId);
                        this.storyComposerCloseTimerId = null;
                    }
                    this.cancelDeletePost();

                    this.avatarImageUrl = profile.imageUrl?.trim()
                        ? profile.imageUrl
                        : this.buildAvatarImage(profile.displayName, profile.handle);

                    if (this.isOwnProfile) {
                        this.isFollowing = false;
                        this.isRequested = false;
                        this.followRequiresApproval = false;
                        this.isBlocked = false;
                        this.isBlockedByTarget = false;
                        this.isMuted = false;
                        this.clearFollowStateTimer();
                        this.followState = 'idle';
                    } else {
                        await this.refreshFollowStateAsync(profile.id);
                        await this.refreshSafetyStateAsync(profile.id);
                    }

                    if (this.isBlockedView) {
                        this.posts = [];
                        this.reels = [];
                        this.activitySummary = null;
                        this.creatorAnalytics = null;
                        this.creatorAnalyticsError = '';
                        this.loadingCreatorAnalytics = false;
                        this.storyCollections = [];
                        this.storyArchive = [];
                        this.selectedStoryCollectionId = '';
                        this.viewedProfileHasActiveStory = false;
                        this.viewedProfileHasUnseenStory = false;
                        this.closeStoryViewer();
                    } else {
                        await this.loadStoryCollectionsAsync(profile.handle);

                        if (this.isOwnProfile) {
                            await this.loadStoryArchiveAsync();
                        } else {
                            this.storyArchive = [];
                        }

                        const storyState = await this.loadStoryStateForHandleAsync(profile.handle);
                        this.viewedProfileHasActiveStory = storyState.hasActive;
                        this.viewedProfileHasUnseenStory = storyState.hasUnseen;
                        await this.tryOpenPendingOwnStoryFromQuery();

                        try {
                            this.posts = await this.loadPostsForProfileAsync(profile.handle);
                        } catch {
                            this.posts = [];
                            this.error = 'Could not load posts for this profile right now.';
                        }

                        try {
                            this.reels = await this.loadReelsForProfileAsync(profile.handle);
                        } catch {
                            this.reels = [];
                            if (!this.error) {
                                this.error = 'Could not load reels for this profile right now.';
                            }
                        }

                        try {
                            this.activitySummary = await this.session.loadProfileActivitySummaryAsync(profile.handle);
                        } catch {
                            this.activitySummary = null;
                        }

                        if (this.isOwnProfile) {
                            void this.loadCreatorAnalyticsAsync(profile.id);
                        } else {
                            this.creatorAnalytics = null;
                            this.creatorAnalyticsError = '';
                            this.loadingCreatorAnalytics = false;
                        }
                    }
                } catch {
                    this.error = this.viewedHandle
                        ? 'Could not load this profile right now.'
                        : 'Could not load your profile details right now.';
                    this.viewedProfile = null;
                    this.storyCollections = [];
                    this.storyArchive = [];
                    this.selectedStoryCollectionId = '';
                    this.viewedProfileHasActiveStory = false;
                    this.viewedProfileHasUnseenStory = false;
                    this.posts = [];
                    this.activitySummary = null;
                    this.creatorAnalytics = null;
                    this.creatorAnalyticsError = '';
                    this.loadingCreatorAnalytics = false;
                    this.isBlocked = false;
                    this.isBlockedByTarget = false;
                    this.isMuted = false;
                } finally {
                    this.loading = false;
                    this.cdr.detectChanges();
                }
            } while (this.reloadQueued);
        } finally {
            this.loadInFlight = false;
        }
    }

    private async loadCreatorAnalyticsAsync(profileId: string): Promise<void> {
        if (!this.isOwnProfile || this.viewedProfile?.id !== profileId) {
            return;
        }

        this.loadingCreatorAnalytics = true;
        this.creatorAnalyticsError = '';
        this.creatorAnalytics = null;
        this.cdr.detectChanges();

        try {
            const summary = await this.session.loadCreatorReelAnalyticsAsync(30);
            if (!this.isOwnProfile || this.viewedProfile?.id !== profileId) {
                return;
            }

            this.creatorAnalytics = summary;
        } catch {
            if (!this.isOwnProfile || this.viewedProfile?.id !== profileId) {
                return;
            }

            this.creatorAnalytics = null;
            this.creatorAnalyticsError = 'Could not load creator analytics right now.';
        } finally {
            if (this.isOwnProfile && this.viewedProfile?.id === profileId) {
                this.loadingCreatorAnalytics = false;
                this.cdr.detectChanges();
            }
        }
    }

    displayPostContent(post: PostDto): string {
        if (!post.content) {
            return '';
        }

        if (!post.imageUrl) {
            return post.content;
        }

        return post.content
            .replace(/(?:blob:[^\s]+|https?:\/\/[^\s]+)/gi, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    getPostRepostCount(postId: string): number {
        this.ensurePostRepostCounts();
        return this.repostCountsByPostId.get(postId) ?? 0;
    }

    private ensurePostRepostCounts(): void {
        if (this.repostCountSource === this.posts) {
            return;
        }

        this.repostCountSource = this.posts;
        this.repostCountsByPostId = buildSharedPostReferenceCounts(this.posts);
    }

    startEdit(post: PostDto): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.editingPostId = post.id;
        this.editContent = post.content;
        this.error = '';
    }

    cancelEdit(): void {
        this.editingPostId = null;
        this.editContent = '';
    }

    async saveEdit(postId: string): Promise<void> {
        if (this.savingPost) {
            return;
        }

        this.savingPost = true;
        this.error = '';

        try {
            await this.session.updatePostAsync(postId, this.editContent);
            this.cancelEdit();
            await this.load();
        } catch {
            this.error = 'Could not update post.';
        } finally {
            this.savingPost = false;
        }
    }

    requestDeletePost(postId: string): void {
        if (!this.isOwnProfile) {
            return;
        }

        if (this.deletingPostId) {
            return;
        }

        this.pendingDeletePostId = postId;
    }

    cancelDeletePost(): void {
        if (this.deletingPostId) {
            return;
        }

        this.pendingDeletePostId = null;
    }

    async confirmDeletePost(): Promise<void> {
        if (!this.isOwnProfile) {
            return;
        }

        const postId = this.pendingDeletePostId;
        if (!postId || this.deletingPostId) {
            return;
        }

        this.deletingPostId = postId;
        this.error = '';

        try {
            await this.session.deletePostAsync(postId);
            if (this.editingPostId === postId) {
                this.cancelEdit();
            }

            await this.load();
        } catch {
            this.error = 'Could not delete post.';
        } finally {
            this.pendingDeletePostId = null;
            this.deletingPostId = null;
        }
    }

    async toggleLike(post: PostDto): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.toggleLike(post.id), 'Could not update like right now.');
    }

    async setReaction(post: PostDto, reactionType: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.setReaction(post.id, reactionType), 'Could not set reaction right now.');
    }

    async clearReaction(post: PostDto): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.clearReaction(post.id), 'Could not clear reaction right now.');
    }

    isPostSaved(postId: string): boolean {
        return this.session.isPostSaved(postId);
    }

    async toggleSavedPost(post: PostDto): Promise<void> {
        if (!post?.id) {
            return;
        }

        try {
            const savedItemId = this.session.getSavedItemIdForPost(post.id);
            if (savedItemId) {
                await this.session.unsaveItemAsync(savedItemId);
                this.session.message = 'Post removed from saved.';
            } else {
                await this.session.openSaveToCollectionModalAsync({
                    kind: 'post',
                    itemId: post.id,
                    label: `@${post.authorHandle}'s post`
                });
            }
        } catch {
            this.session.message = 'Could not update saved status right now.';
        }
    }

    async addComment(post: PostDto, payload: string | { content: string; parentCommentId?: string | null }): Promise<void> {
        const content = typeof payload === 'string' ? payload : payload.content;
        const parentCommentId = typeof payload === 'string' ? null : (payload.parentCommentId ?? null);
        await this.runPostMutation(post.id, () => this.postInteractions.addComment(post.id, content, parentCommentId), 'Could not add comment right now.');
    }

    async updateComment(post: PostDto, commentId: string, content: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.updateComment(post.id, commentId, content), 'Could not update comment right now.');
    }

    async deleteComment(post: PostDto, commentId: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.deleteComment(post.id, commentId), 'Could not delete comment right now.');
    }

    async setCommentReaction(post: PostDto, commentId: string, reactionType: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.setCommentReaction(post.id, commentId, reactionType), 'Could not react to comment right now.');
    }

    async clearCommentReaction(post: PostDto, commentId: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.clearCommentReaction(post.id, commentId), 'Could not clear comment reaction right now.');
    }

    async sharePostToFeed(post: PostDto): Promise<void> {
        this.openShareModal(post, 'feed');
    }

    async sharePostToChat(post: PostDto): Promise<void> {
        this.openShareModal(post, 'chat');
    }

    async toggleReelLike(reel: ReelDto): Promise<void> {
        if (this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.reactingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.reelInteractions.toggleLike(reel.id);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    async addReelComment(event: ReelCommentCreateEvent): Promise<void> {
        const { reel, content, parentCommentId } = event;
        const trimmed = content.trim();
        if (!trimmed || this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.reelInteractions.addComment(reel.id, trimmed, parentCommentId ?? null);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not add reel comment right now.';
        } finally {
            this.commentingReelId = null;
        }
    }

    async updateReelComment(event: ReelCommentUpdateEvent): Promise<void> {
        const { reel, commentId, content } = event;
        const trimmed = content.trim();
        if (!trimmed || this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.reelInteractions.updateComment(reel.id, commentId, trimmed);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel comment right now.';
        } finally {
            this.commentingReelId = null;
        }
    }

    requestDeleteReelComment(event: ReelCommentDeleteEvent): void {
        this.pendingDeleteReelComment = { reelId: event.reel.id, commentId: event.comment.id };
    }

    cancelDeleteReelComment(): void {
        this.pendingDeleteReelComment = null;
    }

    async confirmDeleteReelComment(): Promise<void> {
        const pending = this.pendingDeleteReelComment;
        if (!pending || this.deletingReelCommentId || this.commentingReelId === pending.reelId) {
            return;
        }

        this.deletingReelCommentId = pending.commentId;
        this.commentingReelId = pending.reelId;
        this.error = '';
        try {
            const updated = await this.reelInteractions.deleteComment(pending.reelId, pending.commentId);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not delete reel comment right now.';
        } finally {
            this.pendingDeleteReelComment = null;
            this.commentingReelId = null;
            this.deletingReelCommentId = null;
        }
    }

    async toggleReelCommentLike(event: { reel: ReelDto; commentId: string }): Promise<void> {
        const { reel, commentId } = event;
        if (this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.reactingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.reelInteractions.toggleCommentLike(reel.id, commentId);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel comment like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    async updateReelCaption(reel: ReelDto, caption: string): Promise<void> {
        if (this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.updatingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.session.updateReelAsync(reel.id, caption);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel right now.';
        } finally {
            this.updatingReelId = null;
        }
    }

    deleteReel(reel: ReelDto): void {
        if (this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.pendingDeleteReelId = reel.id;
    }

    cancelDeleteReel(): void {
        if (this.deletingReelId) {
            return;
        }

        this.pendingDeleteReelId = null;
    }

    async confirmDeleteReel(): Promise<void> {
        const reelId = this.pendingDeleteReelId;
        if (!reelId || this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.deletingReelId = reelId;
        this.error = '';

        try {
            await this.session.deleteReelAsync(reelId);
            this.reels = this.reels.filter(existing => existing.id !== reelId);
        } catch {
            this.error = 'Could not delete reel right now.';
        } finally {
            this.pendingDeleteReelId = null;
            this.deletingReelId = null;
        }
    }

    shareReelToChat(reel: ReelDto): void {
        openReelShareModal(this, reel);
    }

    async toggleSavedReel(reel: ReelDto): Promise<void> {
        if (!reel?.id) {
            return;
        }

        try {
            const savedItemId = this.session.getSavedItemIdForReel(reel.id);
            if (savedItemId) {
                await this.session.unsaveItemAsync(savedItemId);
                this.session.message = 'Reel removed from saved.';
            } else {
                await this.session.openSaveToCollectionModalAsync({
                    kind: 'reel',
                    itemId: reel.id,
                    label: `@${reel.authorHandle}'s reel`
                });
            }
        } catch {
            this.session.message = 'Could not update saved status right now.';
        }
    }

    cancelReelShareModal(): void {
        cancelReelShareModal(this);
    }

    async submitReelShareAsMessage(request: ShareReelMessageSubmit): Promise<void> {
        const reel = this.pendingShareReel;
        if (!reel) {
            return;
        }

        const succeeded = await this.executeReelShareToChat(reel, request);
        if (succeeded) {
            this.cancelReelShareModal();
        }
    }

    async openProfileOrStory(handle: string, event?: MouseEvent): Promise<void> {
        event?.preventDefault();
        event?.stopPropagation();

        const normalized = handle.trim().toLowerCase();
        if (this.currentProfileHandle === normalized) {
            const openedStory = await this.openStoryForHandle(handle);
            if (openedStory) {
                return;
            }

            if (this.isOwnProfile) {
                this.ngZone.run(() => {
                    this.openStoryComposer();
                    this.cdr.detectChanges();
                });
                return;
            }
        }

        await this.router.navigate(['/users', handle]);
    }

    closeStoryViewer(): void {
        this.activeStoryGroup = null;
        this.activeStoryIndex = 0;
        this.activeStoryCollectionId = null;
        this.storyViewerError = '';
        this.sendingStoryReply = false;
        this.sharingStoryMessage = false;
        this.deletingStory = false;
        this.pendingDeleteStoryId = null;
    }

    showPreviousStory(): void {
        if (!this.hasPreviousStory) {
            return;
        }

        this.activeStoryIndex -= 1;
        void this.markActiveStoryViewed();
    }

    showNextStory(): void {
        if (!this.hasNextStory) {
            this.closeStoryViewer();
            return;
        }

        this.activeStoryIndex += 1;
        this.storyViewerError = '';
        void this.markActiveStoryViewed();
    }

    isStoryLiked(storyId: string): boolean {
        return this.likedStoryIds.has(storyId);
    }

    toggleStoryLike(story: StoryDto): void {
        if (this.likedStoryIds.has(story.id)) {
            this.likedStoryIds.delete(story.id);
            return;
        }

        this.likedStoryIds.add(story.id);
    }

    requestDeleteStory(story: StoryDto): void {
        if (!this.canDeleteActiveStory || this.deletingStory) {
            return;
        }

        this.pendingDeleteStoryId = story.id;
    }

    cancelDeleteStory(): void {
        if (this.deletingStory) {
            return;
        }

        this.pendingDeleteStoryId = null;
    }

    async confirmDeleteStory(): Promise<void> {
        const story = this.activeStory;
        if (!story || this.pendingDeleteStoryId !== story.id || !this.canDeleteActiveStory || this.deletingStory) {
            return;
        }

        this.deletingStory = true;
        this.storyViewerError = '';

        try {
            await this.session.deleteStoryAsync(story.id);
            this.removeStoryFromActiveGroup(story.id);
        } catch {
            this.storyViewerError = 'Could not delete this story right now.';
        } finally {
            this.pendingDeleteStoryId = null;
            this.deletingStory = false;
        }
    }

    async sendStoryReply(event: { story: StoryDto; message: string }): Promise<void> {
        if (this.sendingStoryReply) {
            return;
        }

        const { story, message } = event;
        if (!message.trim()) {
            return;
        }

        if (story.authorId === this.currentProfileId) {
            this.storyViewerError = 'You cannot send a direct message to yourself.';
            return;
        }

        this.storyViewerError = '';
        this.sendingStoryReply = true;

        try {
            const conversation = await this.session.createDirectConversationAsync(story.authorId);
            await this.session.sendChatMessageAsync(conversation.id, message.trim());
        } catch {
            this.storyViewerError = 'Could not send your story reply right now.';
        } finally {
            this.sendingStoryReply = false;
        }
    }

    async shareStoryAsMessage(_story: StoryDto): Promise<void> {
        this.storyViewerError = 'Story sharing from profile is not available yet.';
    }

    async createStoryCollection(): Promise<void> {
        if (!this.isOwnProfile || this.creatingStoryCollection) {
            return;
        }

        const name = this.newStoryCollectionName.trim();
        if (!name) {
            this.error = 'Collection name is required.';
            return;
        }

        this.creatingStoryCollection = true;
        this.error = '';

        try {
            const created = await this.session.createStoryCollectionAsync(name);
            let finalized = created;

            for (const storyId of this.selectedStoryIdsForNewCollection) {
                finalized = await this.session.addStoryToCollectionAsync(created.id, storyId);
            }

            this.storyCollections = [finalized, ...this.storyCollections.filter(collection => collection.id !== finalized.id)];
            this.selectedStoryCollectionId = finalized.id;
            this.newStoryCollectionName = '';
            this.selectedStoryIdsForNewCollection.clear();
            this.showStoryCollectionCreateModal = false;
        } catch {
            this.error = 'Could not create story collection right now.';
        } finally {
            this.creatingStoryCollection = false;
            this.cdr.detectChanges();
        }
    }

    openStoryCollectionCreateModal(): void {
        if (!this.isOwnProfile || this.creatingStoryCollection) {
            return;
        }

        this.selectedStoryIdsForNewCollection.clear();
        this.showStoryCollectionCreateModal = true;
        void this.refreshStoryArchiveForCollectionModalAsync();
    }

    closeStoryCollectionCreateModal(): void {
        if (this.creatingStoryCollection) {
            return;
        }

        this.showStoryCollectionCreateModal = false;
        this.newStoryCollectionName = '';
        this.selectedStoryIdsForNewCollection.clear();
    }

    onStoryCollectionCreateBackdropClick(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.closeStoryCollectionCreateModal();
        }
    }

    toggleStoryForNewCollection(storyId: string): void {
        const normalizedStoryId = storyId.trim();
        if (!normalizedStoryId || this.creatingStoryCollection) {
            return;
        }

        if (this.selectedStoryIdsForNewCollection.has(normalizedStoryId)) {
            this.selectedStoryIdsForNewCollection.delete(normalizedStoryId);
        } else {
            this.selectedStoryIdsForNewCollection.add(normalizedStoryId);
        }
    }

    isStorySelectedForNewCollection(storyId: string): boolean {
        const normalizedStoryId = storyId.trim();
        return !!normalizedStoryId && this.selectedStoryIdsForNewCollection.has(normalizedStoryId);
    }

    async addStoryToSelectedCollection(storyId: string): Promise<void> {
        const normalizedStoryId = storyId.trim();
        if (!this.canAddStoriesToCollection || !normalizedStoryId || !this.selectedStoryCollectionId) {
            return;
        }

        this.addingStoryToCollection = true;
        this.error = '';
        this.storyViewerError = '';

        try {
            const updated = await this.session.addStoryToCollectionAsync(this.selectedStoryCollectionId, normalizedStoryId);
            this.storyCollections = this.storyCollections.map(collection => collection.id === updated.id ? updated : collection);
            if (this.pendingStoryIdForCollectionAdd === normalizedStoryId) {
                this.pendingStoryIdForCollectionAdd = null;
                this.showStoryCollectionAddModal = false;
            }
        } catch {
            if (this.pendingStoryIdForCollectionAdd === normalizedStoryId) {
                this.storyViewerError = 'Could not add story to collection right now.';
            } else {
                this.error = 'Could not add story to collection right now.';
            }
        } finally {
            this.addingStoryToCollection = false;
            this.cdr.detectChanges();
        }
    }

    async removeStoryFromSelectedCollection(storyId: string): Promise<void> {
        const normalizedStoryId = storyId.trim();
        if (!this.canAddStoriesToCollection || !normalizedStoryId || !this.selectedStoryCollectionId) {
            return;
        }

        this.addingStoryToCollection = true;
        this.error = '';
        this.storyViewerError = '';

        try {
            const updated = await this.session.removeStoryFromCollectionAsync(this.selectedStoryCollectionId, normalizedStoryId);
            this.storyCollections = this.storyCollections.map(collection => collection.id === updated.id ? updated : collection);
        } catch {
            this.error = 'Could not remove story from collection right now.';
        } finally {
            this.addingStoryToCollection = false;
            this.cdr.detectChanges();
        }
    }

    async toggleStoryInSelectedCollection(storyId: string): Promise<void> {
        if (this.isStoryInSelectedCollection(storyId)) {
            await this.removeStoryFromSelectedCollection(storyId);
            return;
        }

        await this.addStoryToSelectedCollection(storyId);
    }

    isStoryInSelectedCollection(storyId: string): boolean {
        const normalizedStoryId = storyId.trim();
        if (!normalizedStoryId) {
            return false;
        }

        const collection = this.storyCollections.find(item => item.id === this.selectedStoryCollectionId);
        if (!collection) {
            return false;
        }

        return collection.stories.some(story => story.id === normalizedStoryId);
    }

    openStoryCollectionAddModal(storyId?: string, collectionId?: string): void {
        if (!this.isOwnProfile || this.addingStoryToCollection || this.creatingStoryCollection) {
            return;
        }

        const normalizedStoryId = storyId?.trim() ?? '';
        this.pendingStoryIdForCollectionAdd = normalizedStoryId || null;
        if (collectionId?.trim()) {
            this.selectedStoryCollectionId = collectionId.trim();
        } else if (!this.selectedStoryCollectionId && this.storyCollections.length > 0) {
            this.selectedStoryCollectionId = this.storyCollections[0].id;
        }

        this.showStoryCollectionAddModal = true;
        void this.refreshStoryArchiveForCollectionModalAsync();
    }

    closeStoryCollectionAddModal(): void {
        if (this.addingStoryToCollection || this.deletingStoryCollection) {
            return;
        }

        this.showStoryCollectionAddModal = false;
        this.pendingStoryIdForCollectionAdd = null;
    }

    onStoryCollectionAddBackdropClick(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.closeStoryCollectionAddModal();
        }
    }

    onSaveActiveStoryToCollectionRequested(story: StoryDto): void {
        if (!this.canSaveActiveStoryToCollection) {
            return;
        }

        if (!this.storyCollections.length) {
            this.storyViewerError = 'Create a collection first.';
            return;
        }

        this.storyViewerError = '';
        this.openStoryCollectionAddModal(story.id);
    }

    openStoryCollectionManageModal(collectionId: string, event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();

        if (!this.isOwnProfile) {
            return;
        }

        this.error = '';
        this.openStoryCollectionAddModal(undefined, collectionId);
    }

    requestDeleteSelectedStoryCollection(): void {
        const collection = this.selectedStoryCollection;
        if (!collection || this.deletingStoryCollection) {
            return;
        }

        this.pendingDeleteStoryCollectionId = collection.id;
    }

    cancelDeleteStoryCollection(): void {
        if (this.deletingStoryCollection) {
            return;
        }

        this.pendingDeleteStoryCollectionId = null;
    }

    async confirmDeleteStoryCollection(): Promise<void> {
        const collectionId = this.pendingDeleteStoryCollectionId;
        if (!collectionId || this.deletingStoryCollection) {
            return;
        }

        this.deletingStoryCollection = true;
        this.error = '';

        try {
            await this.session.deleteStoryCollectionAsync(collectionId);
            this.storyCollections = this.storyCollections.filter(collection => collection.id !== collectionId);

            if (this.activeStoryCollectionId === collectionId) {
                this.closeStoryViewer();
            }

            if (this.selectedStoryCollectionId === collectionId) {
                this.selectedStoryCollectionId = this.storyCollections[0]?.id ?? '';
            }

            this.showStoryCollectionAddModal = false;
            this.pendingStoryIdForCollectionAdd = null;
        } catch {
            this.error = 'Could not delete story collection right now.';
        } finally {
            this.pendingDeleteStoryCollectionId = null;
            this.deletingStoryCollection = false;
            this.cdr.detectChanges();
        }
    }

    openStoryCollection(collectionId: string): void {
        const profile = this.viewedProfile;
        if (!profile) {
            return;
        }

        const collection = this.storyCollections.find(item => item.id === collectionId);
        if (!collection || !collection.stories.length) {
            return;
        }

        this.activeStoryCollectionId = collection.id;
        this.activeStoryGroup = {
            authorId: profile.id,
            authorHandle: profile.handle,
            authorImageUrl: profile.imageUrl,
            hasUnseenStories: false,
            stories: collection.stories.map(story => ({ ...story, viewedByMe: true }))
        };
        this.activeStoryIndex = 0;
        this.storyViewerError = '';
        this.cdr.detectChanges();
    }

    openPostReport(post: PostDto): void {
        if (!this.currentProfileId || post.authorId === this.currentProfileId || this.reportingContent) {
            return;
        }

        this.pendingContentReportTarget = { kind: 'post', id: post.id, handle: post.authorHandle };
        this.showContentReportModal = true;
    }

    openReelReport(reel: ReelDto): void {
        if (!this.currentProfileId || reel.authorId === this.currentProfileId || this.reportingContent) {
            return;
        }

        this.pendingContentReportTarget = { kind: 'reel', id: reel.id, handle: reel.authorHandle };
        this.showContentReportModal = true;
    }

    openStoryReport(story: StoryDto): void {
        if (!this.currentProfileId || story.authorId === this.currentProfileId || this.reportingContent) {
            return;
        }

        this.pendingContentReportTarget = { kind: 'story', id: story.id, handle: story.authorHandle };
        this.showContentReportModal = true;
    }

    openPostCommentReport(post: PostDto, commentId: string): void {
        if (!this.currentProfileId || this.reportingContent) {
            return;
        }

        const comment = post.comments.find(item => item.id === commentId);
        if (!comment || comment.authorId === this.currentProfileId) {
            return;
        }

        this.pendingContentReportTarget = { kind: 'comment', id: comment.id, handle: comment.authorHandle };
        this.showContentReportModal = true;
    }

    openReelCommentReport(event: { reel: ReelDto; comment: { id: string; authorId: string; authorHandle: string } }): void {
        if (!this.currentProfileId || this.reportingContent) {
            return;
        }

        if (event.comment.authorId === this.currentProfileId) {
            return;
        }

        this.pendingContentReportTarget = { kind: 'reel-comment', id: event.comment.id, handle: event.comment.authorHandle };
        this.showContentReportModal = true;
    }

    closeContentReportModal(): void {
        if (this.reportingContent) {
            return;
        }

        this.showContentReportModal = false;
        this.pendingContentReportTarget = null;
    }

    async submitContentReport(payload: { reason: string; details?: string }): Promise<void> {
        const target = this.pendingContentReportTarget;
        if (!target || this.reportingContent) {
            return;
        }

        const reason = payload.reason.trim();
        const details = payload.details?.trim();
        if (!reason) {
            return;
        }

        this.reportingContent = true;
        this.error = '';
        this.storyViewerError = '';

        try {
            if (target.kind === 'post') {
                await this.session.reportPostAsync(target.id, reason, details || undefined);
            } else if (target.kind === 'reel') {
                await this.session.reportReelAsync(target.id, reason, details || undefined);
            } else if (target.kind === 'story') {
                await this.session.reportStoryAsync(target.id, reason, details || undefined);
            } else if (target.kind === 'comment') {
                await this.session.reportCommentAsync(target.id, reason, details || undefined);
            } else {
                await this.session.reportReelCommentAsync(target.id, reason, details || undefined);
            }

            this.showContentReportModal = false;
            this.pendingContentReportTarget = null;
        } catch {
            const message = 'Could not submit report right now.';
            if (target.kind === 'story') {
                this.storyViewerError = message;
            } else {
                this.error = message;
            }
        } finally {
            this.reportingContent = false;
        }
    }

    cancelShareModal(): void {
        cancelPostShareModal(this);
    }

    async submitShare(note: string): Promise<void> {
        const post = this.pendingSharePost;
        const target = this.pendingShareTarget;
        if (!post || target !== 'feed') {
            return;
        }

        const trimmedNote = note.trim();
        this.shareNote = trimmedNote;

        const succeeded = await this.executeShareToFeed(post, trimmedNote);

        if (succeeded) {
            this.cancelShareModal();
        }
    }

    async submitShareAsMessage(request: SharePostMessageSubmit): Promise<void> {
        const post = this.pendingSharePost;
        const target = this.pendingShareTarget;
        if (!post || target !== 'chat') {
            return;
        }

        const succeeded = await this.executeShareToChat(post, request);

        if (succeeded) {
            this.cancelShareModal();
        }
    }

    private openShareModal(post: PostDto, target: 'feed' | 'chat'): void {
        openPostShareModal(this, post, target, this.savingPost, !!this.deletingPostId);
    }

    private async executeShareToFeed(post: PostDto, shareText: string): Promise<boolean> {
        const state = {
            sharingPostId: this.sharingPostId,
            errorMessage: this.error
        };

        const succeeded = await executePostShareToFeedAndReload(
            state,
            post.id,
            () => this.postInteractions.shareToFeed(post, shareText),
            () => this.load(),
            'Could not share this post right now.',
            this.savingPost,
            !!this.deletingPostId
        );

        this.sharingPostId = state.sharingPostId;
        this.error = state.errorMessage;
        return succeeded;
    }

    private async executeShareToChat(post: PostDto, request: SharePostMessageSubmit): Promise<boolean> {
        const state = {
            sharingPostId: this.sharingPostId,
            errorMessage: this.error
        };

        const succeeded = await executePostShareToChat(
            state,
            post.id,
            request.recipientIds,
            request.groupChatIds,
            () => this.postInteractions.shareToChat(post, request),
            'Could not send this post to chat right now.',
            this.savingPost,
            !!this.deletingPostId
        );

        this.sharingPostId = state.sharingPostId;
        this.error = state.errorMessage;
        return succeeded;
    }

    private async executeReelShareToChat(reel: ReelDto, request: ShareReelMessageSubmit): Promise<boolean> {
        const state = {
            sharingReelId: this.sharingReelId,
            errorMessage: this.error
        };

        const succeeded = await executeReelShareToChat(
            state,
            reel,
            request,
            () => this.reelInteractions.shareToChat(reel, request),
            'Could not send this reel to direct messages right now.'
        );

        this.sharingReelId = state.sharingReelId;
        this.error = state.errorMessage;
        return succeeded;
    }

    async toggleFollow(): Promise<void> {
        if (this.isOwnProfile || !this.viewedProfile || this.followState === 'loading' || this.isBlockedView) {
            return;
        }

        this.setFollowState('loading');

        try {
            if (this.isFollowing) {
                await this.session.unfollowAsync(this.viewedProfile.id);
                this.isFollowing = false;
                this.isRequested = false;
            } else {
                if (this.isRequested) {
                    await this.session.unfollowAsync(this.viewedProfile.id);
                    this.isRequested = false;
                } else {
                    const result = await this.session.followAsync(this.viewedProfile.id);
                    this.isFollowing = result.status !== 'RequestPending';
                    this.isRequested = result.status === 'RequestPending';
                }
            }

            this.setFollowState('success', 1100);
        } catch {
            this.setFollowState('failure', 1400);
        }
    }

    async toggleBlockProfile(): Promise<void> {
        this.closeProfileSafetyMenu();

        const profile = this.viewedProfile;
        if (!profile || this.isOwnProfile || this.blockingProfile || !this.session.isAuthenticated()) {
            return;
        }

        this.blockingProfile = true;
        this.error = '';

        try {
            if (this.isBlocked) {
                await this.session.unblockProfileAsync(profile.id);
                this.isBlocked = false;
            } else {
                await this.session.blockProfileAsync(profile.id);
                this.isBlocked = true;
                this.isFollowing = false;
                this.isRequested = false;
                this.followRequiresApproval = false;
                this.clearFollowStateTimer();
                this.followState = 'idle';
            }
        } catch {
            this.error = this.isBlocked
                ? 'Could not unblock profile right now.'
                : 'Could not block profile right now.';
        } finally {
            this.blockingProfile = false;
        }
    }

    openBlockModal(): void {
        const profile = this.viewedProfile;
        if (!profile || this.isOwnProfile || this.blockingProfile || this.isBlocked || !this.session.isAuthenticated()) {
            return;
        }

        this.showBlockModal = true;
    }

    closeBlockModal(): void {
        if (this.blockingProfile) {
            return;
        }

        this.showBlockModal = false;
    }

    async confirmBlockProfile(): Promise<void> {
        if (this.blockingProfile || this.isBlocked) {
            return;
        }

        await this.toggleBlockProfile();
        if (this.isBlocked) {
            this.showBlockModal = false;
        }
    }

    async toggleMuteProfile(): Promise<void> {
        this.closeProfileSafetyMenu();

        const profile = this.viewedProfile;
        if (!profile || this.isOwnProfile || this.mutingProfile || !this.session.isAuthenticated()) {
            return;
        }

        this.mutingProfile = true;
        this.error = '';

        try {
            if (this.isMuted) {
                await this.session.unmuteProfileAsync(profile.id);
                this.isMuted = false;
            } else {
                await this.session.muteProfileAsync(profile.id);
                this.isMuted = true;
            }
        } catch {
            this.error = this.isMuted
                ? 'Could not unmute profile right now.'
                : 'Could not mute profile right now.';
        } finally {
            this.mutingProfile = false;
        }
    }

    openReportModal(): void {
        this.closeProfileSafetyMenu();

        const profile = this.viewedProfile;
        if (!profile || this.isOwnProfile || this.reportingProfile || !this.session.isAuthenticated()) {
            return;
        }

        this.showReportModal = true;
    }

    closeReportModal(): void {
        if (this.reportingProfile) {
            return;
        }

        this.showReportModal = false;
    }

    async submitProfileReport(payload: { reason: string; details?: string }): Promise<void> {
        const profile = this.viewedProfile;
        if (!profile || this.isOwnProfile || this.reportingProfile || !this.session.isAuthenticated()) {
            return;
        }

        const reason = payload.reason.trim();
        const details = payload.details?.trim();
        if (!reason) {
            return;
        }

        this.reportingProfile = true;
        this.error = '';

        try {
            await this.session.reportProfileAsync(profile.id, reason, details || undefined);
            this.showReportModal = false;
        } catch {
            this.error = 'Could not submit report right now.';
        } finally {
            this.reportingProfile = false;
        }
    }

    private applyPostUpdate(updated: PostDto): void {
        this.posts = this.posts.map(post => post.id === updated.id ? updated : post);
    }

    private get viewedProfileStoryPresenceGroups(): StoryGroupDto[] {
        const profile = this.viewedProfile;
        if (!profile || !this.viewedProfileHasActiveStory) {
            return [];
        }

        return [{
            authorId: profile.id,
            authorHandle: profile.handle,
            authorImageUrl: profile.imageUrl,
            hasUnseenStories: this.viewedProfileHasUnseenStory,
            stories: []
        }];
    }

    private applyReelUpdate(updated: ReelDto): void {
        this.reels = this.reels.map(reel => reel.id === updated.id ? updated : reel);
    }

    private async runPostMutation(postId: string, work: () => Promise<PostDto>, failureMessage: string): Promise<void> {
        if (this.reactingPostId === postId) {
            return;
        }

        this.reactingPostId = postId;
        try {
            const updated = await work();
            this.applyPostUpdate(updated);
        } catch {
            this.error = failureMessage;
        } finally {
            this.reactingPostId = null;
        }
    }

    private async refreshFollowStateAsync(followedId: string): Promise<void> {
        try {
            const status = await this.session.getFollowStatusAsync(followedId);
            this.isFollowing = status.isFollowing;
            this.isRequested = status.isRequested;
            this.followRequiresApproval = status.requiresApproval;
        } catch {
            this.isFollowing = false;
            this.isRequested = false;
            this.followRequiresApproval = false;
        }
    }

    private async refreshSafetyStateAsync(targetProfileId: string): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.isBlocked = false;
            this.isBlockedByTarget = false;
            this.isMuted = false;
            return;
        }

        try {
            const status = await this.session.getSafetyStatusAsync(targetProfileId);
            this.isBlocked = status.isBlocked;
            this.isBlockedByTarget = status.isBlockedByTarget === true;
            this.isMuted = status.isMuted;
        } catch {
            this.isBlocked = false;
            this.isBlockedByTarget = false;
            this.isMuted = false;
        }
    }

    private async loadPostsForProfileAsync(handle: string): Promise<PostDto[]> {
        if (!this.session.isAuthenticated()) {
            return this.session.loadPublicPostsByAuthorHandleAsync(handle);
        }

        try {
            return await this.session.loadPostsByAuthorHandleAsync(handle);
        } catch {
            const fallbackResults = await this.session.searchPostsAsync(handle);
            const normalizedHandle = handle.trim().toLowerCase();
            return fallbackResults.filter(post => post.authorHandle.toLowerCase() === normalizedHandle);
        }
    }

    private async loadReelsForProfileAsync(handle: string): Promise<ReelDto[]> {
        if (!this.session.isAuthenticated()) {
            return this.session.loadPublicReelsByAuthorHandleAsync(handle, 80);
        }

        try {
            return await this.session.loadReelsByAuthorHandleAsync(handle);
        } catch {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadReelFeedAsync(80, 'for-you'),
                this.session.loadReelFeedAsync(80, 'following')
            ]);

            const merged = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            const normalizedHandle = handle.trim().toLowerCase();
            return merged.filter(reel => reel.authorHandle.toLowerCase() === normalizedHandle);
        }
    }

    private async loadStoryStateForHandleAsync(handle: string): Promise<{ hasActive: boolean; hasUnseen: boolean }> {
        const normalized = handle.trim().toLowerCase();

        if (!this.session.isAuthenticated()) {
            const group = await this.session.loadPublicStoriesByAuthorHandleAsync(normalized);
            return {
                hasActive: !!group,
                hasUnseen: !!group?.hasUnseenStories
            };
        }

        try {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadStoryFeedAsync(80, 'for-you'),
                this.session.loadStoryFeedAsync(80, 'following')
            ]);

            const merged = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            const group = merged.find((item: StoryGroupDto) => item.authorHandle.trim().toLowerCase() === normalized);
            return {
                hasActive: !!group,
                hasUnseen: !!group?.hasUnseenStories
            };
        } catch {
            return { hasActive: false, hasUnseen: false };
        }
    }

    private async openStoryForHandle(handle: string): Promise<boolean> {
        const group = await this.loadStoryGroupForHandleAsync(handle);
        if (!group || !group.stories.length) {
            return false;
        }

        this.ngZone.run(() => {
            this.activeStoryCollectionId = null;
            this.activeStoryGroup = group;
            this.viewedProfileHasActiveStory = true;
            this.viewedProfileHasUnseenStory = group.hasUnseenStories;
            this.activeStoryIndex = this.getNewestUnseenStoryIndex(group.stories);
            this.storyViewerError = '';
            this.cdr.detectChanges();
        });

        void this.markActiveStoryViewed();
        return true;
    }

    private async tryOpenPendingOwnStoryFromQuery(): Promise<void> {
        if (!this.pendingOpenStoryFromQuery || this.loading) {
            return;
        }

        const handle = this.viewedProfile?.handle?.trim().toLowerCase();
        if (!handle || this.currentProfileHandle !== handle) {
            this.pendingOpenStoryFromQuery = false;
            return;
        }

        this.pendingOpenStoryFromQuery = false;
        await this.openStoryForHandle(handle);

        await this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { story: null },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
    }

    private async loadStoryGroupForHandleAsync(handle: string): Promise<StoryGroupDto | null> {
        const normalized = handle.trim().toLowerCase();

        if (!this.session.isAuthenticated()) {
            return this.session.loadPublicStoriesByAuthorHandleAsync(normalized);
        }

        try {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadStoryFeedAsync(80, 'for-you'),
                this.session.loadStoryFeedAsync(80, 'following')
            ]);

            const merged = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            return merged.find(group => group.authorHandle.trim().toLowerCase() === normalized) ?? null;
        } catch {
            return null;
        }
    }

    private async markActiveStoryViewed(): Promise<void> {
        if (this.activeStoryCollectionId) {
            return;
        }

        const story = this.activeStory;
        if (!story || story.viewedByMe || this.markingStoryId) {
            return;
        }

        this.markingStoryId = story.id;
        try {
            await this.session.markStoryViewedAsync(story.id);
            if (!this.activeStoryGroup) {
                return;
            }

            this.activeStoryGroup = {
                ...this.activeStoryGroup,
                stories: this.activeStoryGroup.stories.map(item => item.id === story.id ? { ...item, viewedByMe: true } : item),
                hasUnseenStories: this.activeStoryGroup.stories.some(item => item.id !== story.id && !item.viewedByMe)
            };
            this.viewedProfileHasUnseenStory = this.activeStoryGroup.hasUnseenStories;
        } catch {
            return;
        } finally {
            this.markingStoryId = null;
        }
    }

    private getNewestUnseenStoryIndex(stories: Array<{ viewedByMe: boolean; createdAtUtc: string }>): number {
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
        let selectedTimestamp = Number.POSITIVE_INFINITY;

        for (let index = 0; index < stories.length; index += 1) {
            const story = stories[index];
            if (story.viewedByMe) {
                continue;
            }

            const parsedTimestamp = Date.parse(story.createdAtUtc);
            const timestamp = Number.isNaN(parsedTimestamp) ? Number.POSITIVE_INFINITY : parsedTimestamp;
            if (selectedIndex < 0 || timestamp < selectedTimestamp) {
                selectedIndex = index;
                selectedTimestamp = timestamp;
            }
        }

        return selectedIndex >= 0 ? selectedIndex : 0;
    }

    private removeStoryFromActiveGroup(storyId: string): void {
        const activeGroup = this.activeStoryGroup;
        if (!activeGroup) {
            return;
        }

        const nextStories = activeGroup.stories.filter(item => item.id !== storyId);
        if (!nextStories.length) {
            this.viewedProfileHasActiveStory = false;
            this.viewedProfileHasUnseenStory = false;
            this.closeStoryViewer();
            return;
        }

        this.activeStoryGroup = {
            ...activeGroup,
            stories: nextStories,
            hasUnseenStories: nextStories.some(item => !item.viewedByMe)
        };
        this.viewedProfileHasUnseenStory = this.activeStoryGroup.hasUnseenStories;
        this.activeStoryIndex = Math.min(this.activeStoryIndex, nextStories.length - 1);
    }

    private async loadStoryCollectionsAsync(handle: string): Promise<void> {
        this.loadingStoryCollections = true;

        try {
            this.storyCollections = await this.session.loadPublicStoryCollectionsByAuthorHandleAsync(handle);

            if (this.selectedStoryCollectionId && !this.storyCollections.some(item => item.id === this.selectedStoryCollectionId)) {
                this.selectedStoryCollectionId = this.storyCollections[0]?.id ?? '';
            }

            if (!this.selectedStoryCollectionId && this.storyCollections.length > 0) {
                this.selectedStoryCollectionId = this.storyCollections[0].id;
            }
        } catch {
            this.storyCollections = [];
            this.selectedStoryCollectionId = '';
        } finally {
            this.loadingStoryCollections = false;
        }
    }

    private async loadStoryArchiveAsync(): Promise<void> {
        try {
            this.storyArchive = await this.session.loadMyStoriesAsync(true, 250);
        } catch {
            this.storyArchive = [];
        }
    }

    private async refreshStoryArchiveForCollectionModalAsync(): Promise<void> {
        await this.loadStoryArchiveAsync();
        this.cdr.detectChanges();
    }

    private syncStoryPreviewToTrimRange(forceSeekToStart = false): void {
        const preview = this.storyPreviewVideoRef?.nativeElement;
        if (!preview || !this.storyMediaIsVideo) {
            return;
        }

        const trimStart = Math.max(0, this.storyTrimStartSeconds);
        const trimEnd = Math.max(trimStart + 1, this.storyTrimEndSeconds);
        const outOfRange = preview.currentTime < trimStart || preview.currentTime >= trimEnd;

        if (forceSeekToStart || outOfRange) {
            preview.currentTime = trimStart;
        }
    }

    private async generateStoryTrimPreviewOptions(file: File, durationSeconds: number): Promise<void> {
        if (!this.storyMediaIsVideo || durationSeconds <= 0) {
            this.clearStoryTrimPreviewOptions();
            return;
        }

        const requestToken = ++this.storyTrimPreviewRefreshToken;
        this.ngZone.run(() => {
            this.generatingStoryTrimPreviews = true;
            this.clearStoryTrimPreviewOptions();
        });

        const sampleCount = 12;
        const lastSecond = Math.max(0, durationSeconds - 1);
        const segment = sampleCount > 1 ? lastSecond / (sampleCount - 1) : 0;
        const times = Array.from({ length: sampleCount }, (_, index) => Math.max(0, Math.min(lastSecond, Math.round(index * segment))));

        try {
            const previews = await Promise.all(times.map(timeSeconds => this.captureStoryVideoFrame(file, timeSeconds)));
            if (requestToken !== this.storyTrimPreviewRefreshToken) {
                previews.forEach(preview => URL.revokeObjectURL(preview.previewUrl));
                return;
            }

            this.ngZone.run(() => {
                this.storyTrimPreviewOptions = previews;
            });
        } catch {
            if (requestToken === this.storyTrimPreviewRefreshToken) {
                this.ngZone.run(() => {
                    this.clearStoryTrimPreviewOptions();
                });
            }
        } finally {
            if (requestToken === this.storyTrimPreviewRefreshToken) {
                this.ngZone.run(() => {
                    this.generatingStoryTrimPreviews = false;
                });
            }
        }
    }

    private clearStoryTrimPreviewOptions(): void {
        for (const option of this.storyTrimPreviewOptions) {
            URL.revokeObjectURL(option.previewUrl);
        }

        this.storyTrimPreviewOptions = [];
    }

    private beginStoryTrimDragging(part: 'start' | 'end' | 'range', clientX: number, track: HTMLElement): void {
        this.draggingStoryTrimPart = part;
        this.storyTrimDragOriginClientX = clientX;
        this.storyTrimDragOriginStartSeconds = this.storyTrimStartSeconds;
        this.storyTrimDragOriginEndSeconds = this.storyTrimEndSeconds;
        this.storyTrimDragTrackWidth = Math.max(1, track.getBoundingClientRect().width);
        this.attachStoryTrimDragListeners();
    }

    private handleStoryTrimPointerMove(event: PointerEvent): void {
        if (!this.draggingStoryTrimPart || this.storyMediaDurationSeconds <= 1) {
            return;
        }

        const deltaX = event.clientX - this.storyTrimDragOriginClientX;
        const deltaSeconds = (deltaX / this.storyTrimDragTrackWidth) * this.storyMediaDurationSeconds;
        const roundedDelta = Math.round(deltaSeconds);

        if (this.draggingStoryTrimPart === 'start') {
            const minStart = Math.max(0, this.storyTrimEndSeconds - ProfilePageComponent.StoryMaxTrimDurationSeconds);
            const nextStart = Math.max(minStart, Math.min(this.storyTrimDragOriginStartSeconds + roundedDelta, this.storyTrimEndSeconds - 1));
            this.storyTrimStartSeconds = nextStart;
            this.syncStoryPreviewToTrimRange();
            return;
        }

        if (this.draggingStoryTrimPart === 'end') {
            const maxEnd = Math.min(this.storyMediaDurationSeconds, this.storyTrimStartSeconds + ProfilePageComponent.StoryMaxTrimDurationSeconds);
            const nextEnd = Math.max(this.storyTrimStartSeconds + 1, Math.min(this.storyTrimDragOriginEndSeconds + roundedDelta, maxEnd));
            this.storyTrimEndSeconds = nextEnd;
            this.syncStoryPreviewToTrimRange();
            return;
        }

        const span = Math.max(1, Math.min(ProfilePageComponent.StoryMaxTrimDurationSeconds, this.storyTrimDragOriginEndSeconds - this.storyTrimDragOriginStartSeconds));
        const nextStart = Math.max(0, Math.min(this.storyTrimDragOriginStartSeconds + roundedDelta, this.storyMediaDurationSeconds - span));
        this.storyTrimStartSeconds = nextStart;
        this.storyTrimEndSeconds = Math.min(this.storyMediaDurationSeconds, nextStart + span);
        this.syncStoryPreviewToTrimRange();
    }

    private stopStoryTrimDragging(): void {
        this.draggingStoryTrimPart = null;
        this.detachStoryTrimDragListeners();
    }

    private attachStoryTrimDragListeners(): void {
        window.addEventListener('pointermove', this.onGlobalStoryTrimPointerMove);
        window.addEventListener('pointerup', this.onGlobalStoryTrimPointerUp);
    }

    private detachStoryTrimDragListeners(): void {
        window.removeEventListener('pointermove', this.onGlobalStoryTrimPointerMove);
        window.removeEventListener('pointerup', this.onGlobalStoryTrimPointerUp);
    }

    private handleStoryFramePointerMove(event: PointerEvent): void {
        if (!this.draggingStoryFrame) {
            return;
        }

        const deltaX = event.clientX - this.storyFrameDragOriginClientX;
        const deltaY = event.clientY - this.storyFrameDragOriginClientY;
        const offsetDeltaX = (deltaX / this.storyFrameDragViewportWidth) * 100;
        const offsetDeltaY = (deltaY / this.storyFrameDragViewportHeight) * 100;

        this.storyFrameOffsetX = this.clampStoryFrameOffset(this.storyFrameDragOriginOffsetX + offsetDeltaX);
        this.storyFrameOffsetY = this.clampStoryFrameOffset(this.storyFrameDragOriginOffsetY + offsetDeltaY);
    }

    private stopStoryFrameDragging(): void {
        this.draggingStoryFrame = false;
        this.detachStoryFrameDragListeners();
    }

    private attachStoryFrameDragListeners(): void {
        window.addEventListener('pointermove', this.onStoryFramePointerMove);
        window.addEventListener('pointerup', this.onStoryFramePointerUp);
        window.addEventListener('pointercancel', this.onStoryFramePointerUp);
    }

    private detachStoryFrameDragListeners(): void {
        window.removeEventListener('pointermove', this.onStoryFramePointerMove);
        window.removeEventListener('pointerup', this.onStoryFramePointerUp);
        window.removeEventListener('pointercancel', this.onStoryFramePointerUp);
    }

    private clampStoryFrameOffset(value: number): number {
        const limit = ProfilePageComponent.StoryFrameOffsetLimit;
        return Math.max(-limit, Math.min(limit, value));
    }

    private hasStoryFrameCropShift(): boolean {
        return Math.abs(this.storyFrameOffsetX) > 0.5 || Math.abs(this.storyFrameOffsetY) > 0.5;
    }

    private async buildProcessedStoryMedia(file: File): Promise<File> {
        if (this.storyMediaIsVideo) {
            return this.buildTrimmedStoryVideoOrOriginal(file);
        }

        return this.buildCroppedStoryImageOrOriginal(file);
    }

    private async readVideoDurationSeconds(file: File): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.src = url;
            video.preload = 'metadata';

            const cleanup = () => {
                URL.revokeObjectURL(url);
                video.removeAttribute('src');
                video.load();
            };

            video.onloadedmetadata = () => {
                const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
                cleanup();
                if (duration <= 0) {
                    reject(new Error('Invalid video duration.'));
                    return;
                }

                resolve(duration);
            };

            video.onerror = () => {
                cleanup();
                reject(new Error('Could not read video metadata.'));
            };
        });
    }

    private async buildCroppedStoryImageOrOriginal(file: File): Promise<File> {
        if (!file.type.startsWith('image/')) {
            return file;
        }

        if (!this.hasStoryFrameCropShift()) {
            return file;
        }

        try {
            const image = await this.loadImageFromFile(file);
            const sourceWidth = image.naturalWidth || image.width;
            const sourceHeight = image.naturalHeight || image.height;
            if (!sourceWidth || !sourceHeight) {
                return file;
            }

            const crop = this.getStoryFrameCropForSource(sourceWidth, sourceHeight);
            const canvas = document.createElement('canvas');
            canvas.width = crop.width;
            canvas.height = crop.height;

            const context = canvas.getContext('2d');
            if (!context) {
                return file;
            }

            context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
            const blob = await this.canvasToBlob(canvas, 'image/jpeg', 0.9);
            return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-9x16.jpg`, { type: 'image/jpeg' });
        } catch {
            this.storyComposerError = 'Could not apply framing to selected image. Uploaded original instead.';
            return file;
        }
    }

    private async buildTrimmedStoryVideoOrOriginal(file: File): Promise<File> {
        if (!this.storyMediaIsVideo) {
            return file;
        }

        const trimStart = Math.max(0, Math.floor(this.storyTrimStartSeconds));
        const trimEnd = Math.max(trimStart + 1, Math.ceil(this.storyTrimEndSeconds));
        const fullDuration = Math.max(1, Math.round(this.storyMediaDurationSeconds));
        const hasFrameCrop = this.hasStoryFrameCropShift();

        if (trimStart <= 0 && trimEnd >= fullDuration && !hasFrameCrop) {
            return file;
        }

        if (!('MediaRecorder' in window)) {
            this.storyComposerError = 'Trim preview saved, but your browser uploaded the full video because MediaRecorder is not available.';
            return file;
        }

        return new Promise<File>((resolve) => {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.src = url;
            video.muted = false;
            video.volume = 0;
            video.playsInline = true;

            let mediaStream: MediaStream | null = null;
            let monitorStopId = 0;
            let drawFrameId = 0;

            const cleanup = () => {
                window.cancelAnimationFrame(drawFrameId);
                window.cancelAnimationFrame(monitorStopId);
                URL.revokeObjectURL(url);
                video.pause();
                video.removeAttribute('src');
                video.load();
                mediaStream?.getTracks().forEach(track => track.stop());
                mediaStream = null;
            };

            video.onloadedmetadata = async () => {
                try {
                    const sourceWidth = video.videoWidth || 720;
                    const sourceHeight = video.videoHeight || 1280;
                    const crop = this.getStoryFrameCropForSource(sourceWidth, sourceHeight);
                    const outputWidth = 720;
                    const outputHeight = Math.max(1, Math.round(outputWidth / ProfilePageComponent.StoryOutputAspect));

                    const canvas = document.createElement('canvas');
                    canvas.width = outputWidth;
                    canvas.height = outputHeight;

                    const context = canvas.getContext('2d');
                    if (!context) {
                        this.storyComposerError = 'Could not apply framing to trimmed story. Uploaded original instead.';
                        cleanup();
                        resolve(file);
                        return;
                    }

                    mediaStream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30) ?? null;

                    if (!mediaStream) {
                        this.storyComposerError = 'Trim preview saved, but this browser does not support video trimming upload.';
                        cleanup();
                        resolve(file);
                        return;
                    }

                    const sourceStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }).captureStream?.()
                        ?? (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();
                    const sourceAudioTracks = sourceStream?.getAudioTracks() ?? [];
                    for (const track of sourceAudioTracks) {
                        mediaStream.addTrack(track);
                    }

                    const chunks: BlobPart[] = [];
                    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                        ? 'video/webm;codecs=vp9'
                        : 'video/webm';
                    const recorder = new MediaRecorder(mediaStream, { mimeType });

                    const drawFrame = () => {
                        context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, outputWidth, outputHeight);
                        if (!video.paused && !video.ended) {
                            drawFrameId = window.requestAnimationFrame(drawFrame);
                        }
                    };

                    const monitorStop = () => {
                        if (video.currentTime >= trimEnd || video.ended) {
                            window.cancelAnimationFrame(drawFrameId);
                            video.pause();
                            recorder.stop();
                            return;
                        }

                        monitorStopId = window.requestAnimationFrame(monitorStop);
                    };

                    recorder.ondataavailable = event => {
                        if (event.data && event.data.size > 0) {
                            chunks.push(event.data);
                        }
                    };

                    recorder.onstop = () => {
                        cleanup();
                        if (!chunks.length) {
                            resolve(file);
                            return;
                        }

                        const blob = new Blob(chunks, { type: mimeType });
                        resolve(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-trim.webm`, { type: mimeType }));
                    };

                    video.onseeked = async () => {
                        recorder.start(250);
                        await video.play();
                        drawFrame();
                        monitorStop();
                    };

                    video.currentTime = trimStart;
                } catch {
                    cleanup();
                    this.storyComposerError = 'Trim preview saved, but upload used original video due to processing limits.';
                    resolve(file);
                }
            };

            video.onerror = () => {
                cleanup();
                resolve(file);
            };
        });
    }

    private async captureStoryVideoFrame(file: File, timeSeconds: number): Promise<StoryTrimPreviewOption> {
        const blob = await this.captureStoryVideoFrameBlob(file, timeSeconds);
        return {
            previewUrl: URL.createObjectURL(blob)
        };
    }

    private async captureStoryVideoFrameBlob(file: File, timeSeconds: number): Promise<Blob> {
        return new Promise<Blob>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.src = url;
            video.preload = 'auto';
            video.playsInline = true;

            const cleanup = () => {
                URL.revokeObjectURL(url);
                video.removeAttribute('src');
                video.load();
            };

            video.onloadedmetadata = () => {
                video.currentTime = Math.max(0, Math.min(timeSeconds, Math.max(0, video.duration - 0.05)));
            };

            video.onseeked = async () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, video.videoWidth || 320);
                    canvas.height = Math.max(1, video.videoHeight || 180);
                    const context = canvas.getContext('2d');
                    if (!context) {
                        cleanup();
                        reject(new Error('Could not capture frame context.'));
                        return;
                    }

                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const blob = await this.canvasToBlob(canvas, 'image/jpeg', 0.85);
                    cleanup();
                    resolve(blob);
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            };

            video.onerror = () => {
                cleanup();
                reject(new Error('Could not load video for frame capture.'));
            };
        });
    }

    private async buildStoryThumbnailForUpload(file: File): Promise<File | undefined> {
        if (!file.type.startsWith('video/')) {
            return undefined;
        }

        try {
            const captureTime = Math.min(0.1, Math.max(0, this.storyTrimStartSeconds));
            const blob = await this.captureStoryVideoFrameBlob(file, captureTime);
            return new File([blob], `story-thumb-${Date.now()}.jpg`, { type: 'image/jpeg' });
        } catch {
            return undefined;
        }
    }

    private getStoryAspectCrop(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const targetAspect = ProfilePageComponent.StoryOutputAspect;
        const sourceAspect = width / height;

        if (sourceAspect > targetAspect) {
            const cropWidth = Math.max(1, Math.round(height * targetAspect));
            const x = Math.max(0, Math.floor((width - cropWidth) / 2));
            return { x, y: 0, width: cropWidth, height };
        }

        const cropHeight = Math.max(1, Math.round(width / targetAspect));
        const y = Math.max(0, Math.floor((height - cropHeight) / 2));
        return { x: 0, y, width, height: cropHeight };
    }

    private getStoryFrameCropForSource(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const maxAspectCrop = this.getStoryAspectCrop(width, height);
        const frameScale = Math.max(0.4, Math.min(1, ProfilePageComponent.StoryCropFrameHeightPercent / 100));
        const cropWidth = Math.max(1, Math.round(maxAspectCrop.width * frameScale));
        const cropHeight = Math.max(1, Math.round(maxAspectCrop.height * frameScale));

        const availableShiftX = Math.max(0, (width - cropWidth) / 2);
        const availableShiftY = Math.max(0, (height - cropHeight) / 2);
        const normalizedX = this.storyFrameOffsetX / ProfilePageComponent.StoryFrameOffsetLimit;
        const normalizedY = this.storyFrameOffsetY / ProfilePageComponent.StoryFrameOffsetLimit;

        const centerX = (width / 2) + (normalizedX * availableShiftX);
        const centerY = (height / 2) + (normalizedY * availableShiftY);
        const shiftedX = Math.max(0, Math.min(width - cropWidth, Math.round(centerX - (cropWidth / 2))));
        const shiftedY = Math.max(0, Math.min(height - cropHeight, Math.round(centerY - (cropHeight / 2))));

        return {
            x: shiftedX,
            y: shiftedY,
            width: cropWidth,
            height: cropHeight
        };
    }

    private loadImageFromFile(file: File): Promise<HTMLImageElement> {
        return new Promise<HTMLImageElement>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();

            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };

            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Could not load image.'));
            };

            image.src = url;
        });
    }

    private canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(new Error('Could not create image blob.'));
                    return;
                }

                resolve(blob);
            }, type, quality);
        });
    }

    private clearStoryMediaSelection(): void {
        this.stopStoryFrameDragging();
        this.stopStoryTrimDragging();
        this.clearStoryTrimPreviewOptions();
        this.storyTrimPreviewRefreshToken += 1;
        this.generatingStoryTrimPreviews = false;

        if (this.storyMediaObjectUrl) {
            URL.revokeObjectURL(this.storyMediaObjectUrl);
        }

        this.storyMediaObjectUrl = '';
        this.storyMediaFile = null;
        this.markStorySensitive = false;
        this.storyScheduledPublishLocal = '';
        this.storyMediaPreviewUrl = '';
        this.storyMediaIsVideo = false;
        this.storyMediaDurationSeconds = 0;
        this.storyTrimStartSeconds = 0;
        this.storyTrimEndSeconds = 0;
        this.storyPreviewReady = false;
        this.storySourceMediaWidth = 0;
        this.storySourceMediaHeight = 0;
        this.storyFrameZoom = 1;
        this.storyFrameOffsetX = 0;
        this.storyFrameOffsetY = 0;
    }

    private setFollowState(state: 'idle' | 'loading' | 'success' | 'failure', autoResetMs = 0): void {
        this.followState = state;
        this.clearFollowStateTimer();

        if (autoResetMs > 0) {
            this.followStateResetTimerId = window.setTimeout(() => {
                this.followState = 'idle';
                this.followStateResetTimerId = null;
            }, autoResetMs);
        }
    }

    private clearFollowStateTimer(): void {
        if (this.followStateResetTimerId !== null) {
            window.clearTimeout(this.followStateResetTimerId);
            this.followStateResetTimerId = null;
        }
    }

    private toScheduledPublishUtcIso(localValue: string): string | null {
        const normalized = localValue.trim();
        if (!normalized) {
            return null;
        }

        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
            return null;
        }

        return parsed.toISOString();
    }

    private buildAvatarImage(displayName: string, handle: string): string {
        const initial = (displayName.trim().charAt(0) || handle.trim().charAt(0) || 'S').toUpperCase();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1d4ed8" offset="0"/><stop stop-color="#0f172a" offset="1"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="68" font-family="Arial, sans-serif" fill="#ffffff" font-weight="700">${initial}</text></svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    onHeroImageError(): void {
        const profile = this.viewedProfile;
        if (!profile) {
            return;
        }

        this.avatarImageUrl = this.buildAvatarImage(profile.displayName, profile.handle);
    }
}