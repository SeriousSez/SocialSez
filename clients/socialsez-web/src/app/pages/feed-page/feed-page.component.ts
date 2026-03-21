import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, skip } from 'rxjs';
import { CustomFeedDto, EngagementStreakDto, FeedMode, HashtagSearchResultDto, PostDto, ProfileActivitySummaryDto, ProfileDto, ReelDto, StoryDto, StoryGroupDto } from '../../core/api.types';
import { formatRelativeFeedDateTime } from '../../core/date-time.util';
import { executePostShareAction, executePostShareToChat, executePostShareToFeedAndReload } from '../../core/post-share-execution.utils';
import { PostInteractionsService } from '../../core/post-interactions.service';
import { cancelPostShareModal, openPostShareModal } from '../../core/post-share-modal-state.utils';
import { executeReelShareToChat } from '../../core/reel-share-to-chat.utils';
import { ReelInteractionsService } from '../../core/reel-interactions.service';
import { cancelReelShareModal, openReelShareModal } from '../../core/reel-share-modal-state.utils';
import { buildSharedStoryMarker, buildSharedStoryPreview } from '../../core/shared-story.utils';
import { cancelStoryShareModal as cancelStoryShareModalState, openStoryShareModal } from '../../core/story-share-modal-state.utils';
import { executeStoryShareToChat as executeStoryShareToChatCore } from '../../core/story-share-to-chat.utils';
import { StoryPresenceService } from '../../core/story-presence.service';
import { buildSharedPostReferenceCounts } from '../../core/shared-post.utils';
import { FeedReelsListComponent, ReelCommentCreateEvent, ReelCommentDeleteEvent, ReelCommentUpdateEvent, ReelPlaybackProgressEvent } from './feed-reels-list.component';
import { FeedStoryViewerComponent } from './feed-story-viewer.component';
import { ReelComposerModalComponent, ReelUploadStatusEvent } from '../../shared/reel-composer-modal/reel-composer-modal.component';
import { PendingStoryComposerDraft, SessionService } from '../../core/session.service';
import { PostComposerComponent } from '../../shared/post-composer/post-composer.component';
import { ReelBackgroundUploadService } from '../../core/reel-background-upload.service';
import { UploadProgressService } from '../../core/upload-progress.service';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { ShareReelMessageModalComponent, ShareReelMessageSubmit } from '../../shared/share-reel-message-modal/share-reel-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { SegmentedTabItem, SegmentedTabsComponent } from '../../shared/segmented-tabs/segmented-tabs.component';
import { CreateContentMenuComponent } from '../../shared/create-content-menu/create-content-menu.component';
import { ReportModalComponent } from '../../shared/report-modal/report-modal.component';

interface StoryTrimPreviewOption {
    previewUrl: string;
}

interface ProfileSetupChecklistItem {
    key: 'avatar' | 'bio' | 'following' | 'firstPost';
    done: boolean;
    action: 'settings' | 'discover' | 'compose';
}

interface EngagementStreakState {
    current: number;
    best: number;
    lastActiveDate: string;
}

type FeedReportTarget =
    | { kind: 'post'; id: string; handle: string }
    | { kind: 'reel'; id: string; handle: string }
    | { kind: 'story'; id: string; handle: string }
    | { kind: 'comment'; id: string; handle: string }
    | { kind: 'reel-comment'; id: string; handle: string };

@Component({
    selector: 'app-feed-page',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslatePipe, PostCardComponent, PostComposerComponent, ReelComposerModalComponent, FeedReelsListComponent, FeedStoryViewerComponent, SharePostModalComponent, SharePostMessageModalComponent, ShareReelMessageModalComponent, ConfirmModalComponent, SkeletonComponent, SegmentedTabsComponent, CreateContentMenuComponent, ReportModalComponent],
    templateUrl: './feed-page.component.html',
    styleUrl: './feed-page.component.scss'
})
export class FeedPageComponent implements OnDestroy {
    private static readonly StoryFrameOffsetLimit = 50;
    private static readonly StoryCropFrameHeightPercent = 100;
    private static readonly StoryOutputAspect = 9 / 16;
    private static readonly StoryMaxTrimDurationSeconds = 60;
    private static readonly ComposerCloseAnimationDurationMs = 180;

    @ViewChild('storyPreviewVideo') private readonly storyPreviewVideoRef?: ElementRef<HTMLVideoElement>;

    feed: PostDto[] = [];
    reels: ReelDto[] = [];
    storyGroups: StoryGroupDto[] = [];
    customFeeds: CustomFeedDto[] = [];
    private readonly likedStoryIds = new Set<string>();
    storiesLoading = true;
    storiesError = '';
    selectedFeedMode: FeedMode = 'for-you';
    selectedCustomFeedId: string | null = null;
    selectedContentTab: 'posts' | 'reels' = 'posts';

    get contentTabs(): readonly SegmentedTabItem[] {
        return [
            { id: 'posts', label: this.translate.instant('profile.tabs.posts') },
            { id: 'reels', label: this.translate.instant('profile.tabs.reels') }
        ];
    }

    activeStoryGroup: StoryGroupDto | null = null;
    activeStoryIndex = 0;
    loading = true;
    reelsLoading = true;
    reelsError = '';
    error = '';
    reactingPostId: string | null = null;
    reactingReelId: string | null = null;
    commentingReelId: string | null = null;
    editingPostId: string | null = null;
    editContent = '';
    savingPost = false;
    deletingPostId: string | null = null;
    pendingNotInterestedPost: PostDto | null = null;
    pendingNotInterestedReel: ReelDto | null = null;
    pendingDeletePostId: string | null = null;
    deletingReelId: string | null = null;
    pendingDeleteReelId: string | null = null;
    deletingReelCommentId: string | null = null;
    pendingDeleteReelComment: { reelId: string; commentId: string } | null = null;
    sharingPostId: string | null = null;
    sharingReelId: string | null = null;
    sharingStoryId: string | null = null;
    reportingContent = false;
    showContentReportModal = false;
    pendingReportTarget: FeedReportTarget | null = null;
    pendingSharePost: PostDto | null = null;
    pendingShareReel: ReelDto | null = null;
    pendingShareStory: StoryDto | null = null;
    pendingShareTarget: 'feed' | 'chat' | null = null;
    shareNote = '';
    showComposer = false;
    composerClosing = false;
    showStoryComposer = false;
    storyComposerClosing = false;
    storyComposerStep: 1 | 2 = 1;
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
    postingStory = false;
    markStorySensitive = false;
    storyScheduledPublishLocal = '';
    storyComposerError = '';
    storyViewerError = '';
    deletingStory = false;
    pendingDeleteStoryId: string | null = null;
    sendingStoryReply = false;
    sharingStoryMessage = false;
    showReelComposer = false;
    createMenuOpen = false;
    showCustomFeedModal = false;
    customFeedModalMode: 'create' | 'edit' = 'create';
    customFeedDraftName = '';
    customFeedDraftHandles = '';
    customFeedDraftHashtags = '';
    customFeedHandleSuggestions: ProfileDto[] = [];
    customFeedHandleSuggestionsOpen = false;
    customFeedHandleSuggestionsLoading = false;
    customFeedHashtagSuggestions: HashtagSearchResultDto[] = [];
    customFeedHashtagSuggestionsOpen = false;
    customFeedHashtagSuggestionsLoading = false;
    customFeedModalError = '';
    savingCustomFeed = false;
    pendingDeleteCustomFeed: CustomFeedDto | null = null;
    deletingCustomFeed = false;
    compactFeedEnabled = false;
    reelUploadStatus: ReelUploadStatusEvent | null = null;
    private reelUploadStatusHideTimeoutId: number | null = null;
    private composerCloseTimerId: number | null = null;
    private storyComposerCloseTimerId: number | null = null;
    private readonly prefsStorageKey = 'socialsez-web-prefs';
    private readonly profileSetupDismissStorageKey = 'socialsez-web-feed-profile-setup-dismissed-v1';
    private readonly mutedFeedAuthorsStorageKey = 'socialsez-web-feed-muted-authors-v1';
    private readonly engagementStreakStorageKey = 'socialsez-web-engagement-streak-v1';
    private readonly followSuggestionsDismissStorageKey = 'socialsez-web-feed-follow-suggestions-dismissed-v1';
    private readonly hashtagSuggestionsDismissStorageKey = 'socialsez-web-feed-hashtag-suggestions-dismissed-v1';
    private markingStoryId: string | null = null;
    private loadInFlight = false;
    private reloadQueued = false;
    private storyMediaObjectUrl = '';
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
    private customFeedHandleSearchDebounceId: number | null = null;
    private customFeedHandleSearchToken = 0;
    private customFeedHashtagSearchDebounceId: number | null = null;
    private customFeedHashtagSearchToken = 0;
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
    private readonly destroyRef = inject(DestroyRef);
    private readonly ngZone = inject(NgZone);
    private readonly translate = inject(TranslateService);
    private pendingStoryHandleFromRoute: string | null = null;
    private hasLoadedAtLeastOnce = false;
    private repostCountSource: PostDto[] | null = null;
    private repostCountsByPostId = new Map<string, number>();
    private mutedFeedAuthorHandles = new Set<string>();
    private engagementStreakState: EngagementStreakState = {
        current: 0,
        best: 0,
        lastActiveDate: ''
    };
    hasPostDraft = false;
    hasReelDraft = false;
    hasStoryDraft = false;
    followSuggestions: ProfileDto[] = [];
    followingSuggestionProfileId: string | null = null;
    followSuggestionsDismissed = false;
    hashtagSuggestions: HashtagSearchResultDto[] = [];
    followedHashtagTags: string[] = [];
    followingHashtagTag: string | null = null;
    hashtagSuggestionsDismissed = false;
    profileSetupDismissed = false;
    profileActivitySummary: ProfileActivitySummaryDto | null = null;

    constructor(
        private readonly session: SessionService,
        private readonly postInteractions: PostInteractionsService,
        private readonly reelInteractions: ReelInteractionsService,
        private readonly storyPresence: StoryPresenceService,
        private readonly router: Router,
        private readonly route: ActivatedRoute,
        private readonly bgUpload: ReelBackgroundUploadService,
        private readonly uploadProgress: UploadProgressService
    ) {
        this.session.appChanges$
            .pipe(
                filter(change => change === 'posts' || change === 'profile' || change === 'session'),
                skip(1),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe((change) => {
                if (change === 'session') {
                    if (this.session.isAuthenticated()) {
                        void this.syncEngagementStreakFromApi();
                        void this.refreshDraftNudgeState();
                        void this.refreshFollowSuggestionsAsync();
                        void this.refreshHashtagSuggestionsAsync();
                    } else {
                        this.engagementStreakState = { current: 0, best: 0, lastActiveDate: '' };
                        this.persistEngagementStreakState();
                        this.hasPostDraft = false;
                        this.hasReelDraft = false;
                        this.hasStoryDraft = false;
                        this.followSuggestions = [];
                        this.hashtagSuggestions = [];
                        this.followedHashtagTags = [];
                    }
                }

                if (change === 'posts') {
                    void this.refreshDraftNudgeState();
                    void this.refreshHashtagSuggestionsAsync();
                }

                void this.load();
            });

        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                const handle = (params.get('story') ?? '').trim().toLowerCase();
                this.pendingStoryHandleFromRoute = handle || null;
                this.tryOpenPendingStoryHandle();

                const compose = params.get('compose');
                if (compose === 'post' || compose === 'reel' || compose === 'story') {
                    queueMicrotask(() => {
                        if (compose === 'post') {
                            this.openComposer();
                        } else if (compose === 'reel') {
                            this.openReelComposer();
                        } else {
                            this.openStoryComposer();
                        }
                    });

                    void this.router.navigate([], {
                        relativeTo: this.route,
                        queryParams: { compose: null, composeRequest: null },
                        queryParamsHandling: 'merge',
                        replaceUrl: true
                    });
                }
            });

        this.syncCompactFeedPreference();
        this.loadProfileSetupDismissPreference();
        this.loadMutedFeedAuthorsPreference();
        this.loadEngagementStreakState();
        this.loadFollowSuggestionsDismissPreference();
        this.loadHashtagSuggestionsDismissPreference();
        if (this.session.isAuthenticated()) {
            void this.syncEngagementStreakFromApi();
            void this.refreshDraftNudgeState();
            void this.refreshFollowSuggestionsAsync();
            void this.refreshHashtagSuggestionsAsync();
        }

        queueMicrotask(() => {
            void this.loadCustomFeeds();
            if (!this.loadInFlight && !this.hasLoadedAtLeastOnce) {
                void this.load();
            }
        });

        this.bgUpload.status$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(event => {
                this.onReelUploadStatusChanged(event);
                if (event.state === 'success') {
                    void this.load();
                }
            });
    }

    get currentProfileId(): string | null {
        return this.session.profile?.id ?? null;
    }

    get showEngagementStreakCard(): boolean {
        return this.session.isAuthenticated();
    }

    get showDraftNudgeCard(): boolean {
        return this.session.isAuthenticated() && (this.hasPostDraft || this.hasReelDraft || this.hasStoryDraft);
    }

    get showFollowSuggestionsCard(): boolean {
        return this.session.isAuthenticated()
            && !this.followSuggestionsDismissed
            && this.followSuggestions.length > 0
            && this.followingCount < 10;
    }

    get showHashtagSuggestionsCard(): boolean {
        return this.session.isAuthenticated()
            && !this.hashtagSuggestionsDismissed
            && this.hashtagSuggestions.length > 0
            && this.followedHashtagTags.length < 5;
    }

    get engagementStreakCurrentDays(): number {
        return Math.max(0, this.engagementStreakState.current || 0);
    }

    get engagementStreakBestDays(): number {
        return Math.max(this.engagementStreakCurrentDays, this.engagementStreakState.best || 0);
    }

    get hasEngagementToday(): boolean {
        return this.engagementStreakState.lastActiveDate === this.getLocalDateKey();
    }

    get profileSetupChecklist(): readonly ProfileSetupChecklistItem[] {
        return [
            { key: 'avatar', done: this.hasProfileAvatar, action: 'settings' },
            { key: 'bio', done: this.hasProfileBio, action: 'settings' },
            { key: 'following', done: this.followingCount >= 3, action: 'discover' },
            { key: 'firstPost', done: this.postCount >= 1, action: 'compose' }
        ];
    }

    get profileSetupCompletedCount(): number {
        return this.profileSetupChecklist.filter(item => item.done).length;
    }

    get profileSetupTotalCount(): number {
        return this.profileSetupChecklist.length;
    }

    get profileSetupProgressPercent(): number {
        if (this.profileSetupTotalCount === 0) {
            return 0;
        }

        return Math.round((this.profileSetupCompletedCount / this.profileSetupTotalCount) * 100);
    }

    get showProfileSetupCard(): boolean {
        return !this.profileSetupDismissed && this.profileSetupCompletedCount < this.profileSetupTotalCount;
    }

    get hasProfileAvatar(): boolean {
        return !!this.session.profile?.imageUrl?.trim();
    }

    get hasProfileBio(): boolean {
        return !!this.session.profile?.bio?.trim();
    }

    get followingCount(): number {
        return this.profileActivitySummary?.followingCount ?? 0;
    }

    get postCount(): number {
        return this.profileActivitySummary?.postCount ?? 0;
    }

    get selectedCustomFeed(): CustomFeedDto | null {
        return this.customFeeds.find(feed => feed.id === this.selectedCustomFeedId) ?? null;
    }

    get customFeedDraftHandleValues(): string[] {
        return this.parseCustomFeedHandleRules(this.customFeedDraftHandles);
    }

    get customFeedDraftHashtagValues(): string[] {
        return this.parseCustomFeedRules(this.customFeedDraftHashtags, '#');
    }

    get canSaveCustomFeed(): boolean {
        return !!this.customFeedDraftName.trim()
            && (this.customFeedDraftHandleValues.length > 0 || this.customFeedDraftHashtagValues.length > 0);
    }

    get storiesEmptyMessage(): string {
        if (this.selectedCustomFeed) {
            return 'No stories match this custom feed yet.';
        }

        return this.selectedFeedMode === 'following'
            ? 'No stories from people you follow yet.'
            : 'No active stories yet.';
    }

    get postsEmptyMessage(): string {
        if (this.selectedCustomFeed) {
            return 'No posts match this custom feed yet. Add more handles or hashtags to broaden it.';
        }

        return 'No posts yet. Follow people or create your first post to kick off your timeline.';
    }

    get reelsEmptyMessage(): string {
        if (this.selectedCustomFeed) {
            return 'No reels match this custom feed yet.';
        }

        return 'No reels available right now.';
    }

    get hasHiddenFeedCreators(): boolean {
        return this.mutedFeedAuthorHandles.size > 0;
    }

    get visibleStoryGroups(): StoryGroupDto[] {
        return this.storyGroups;
    }

    get currentProfileHandle(): string {
        return (this.session.profile?.handle ?? '').trim().toLowerCase();
    }

    get currentProfileImageUrl(): string {
        return (this.session.profile?.imageUrl ?? '').trim();
    }

    get hideSensitiveMediaEnabled(): boolean {
        return this.session.getHideSensitiveMediaPreference();
    }

    get ownVisibleStoryGroup(): StoryGroupDto | null {
        const handle = this.currentProfileHandle;
        if (!handle) {
            return null;
        }

        return this.visibleStoryGroups.find(group => (group.authorHandle ?? '').trim().toLowerCase() === handle) ?? null;
    }

    get hasPendingStoryUpload(): boolean {
        return this.uploadProgress.items.some(item => item.status === 'pending' && item.kind === 'story');
    }

    get storyUploadInProgress(): boolean {
        return this.postingStory || this.hasPendingStoryUpload;
    }

    get nonOwnVisibleStoryGroups(): StoryGroupDto[] {
        const handle = this.currentProfileHandle;
        if (!handle) {
            return this.visibleStoryGroups;
        }

        return this.visibleStoryGroups.filter(group => (group.authorHandle ?? '').trim().toLowerCase() !== handle);
    }

    get firstStoryToPreload(): StoryDto | null {
        for (const group of this.visibleStoryGroups) {
            const first = group.stories?.[0] ?? null;
            if (first?.mediaUrl?.trim()) {
                return first;
            }
        }

        return null;
    }

    isLikelyVideoStoryMedia(mediaUrl: string): boolean {
        const normalized = mediaUrl.trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)(?:\?.*)?$/i.test(normalized)) {
            return false;
        }

        if (/\.(mp4|webm|mov|m4v|ogv|ogg)(?:\?.*)?$/i.test(normalized)) {
            return true;
        }

        return true;
    }

    onOwnStoryItemClicked(): void {
        const ownGroup = this.ownVisibleStoryGroup;
        if (ownGroup) {
            this.openStoryGroup(ownGroup);
            return;
        }

        this.openStoryComposer();
    }

    get activeStoryAuthorHandles(): string[] {
        return this.storyPresence.getActiveStoryAuthorHandles(this.storyGroups);
    }

    get activeUnseenStoryAuthorHandles(): string[] {
        return this.storyPresence.getUnseenStoryAuthorHandles(this.storyGroups);
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

    get canDeleteActiveStory(): boolean {
        const story = this.activeStory;
        return !!story && !!this.currentProfileId && story.authorId === this.currentProfileId;
    }

    get canReportActiveStory(): boolean {
        const story = this.activeStory;
        return !!story && !!this.currentProfileId && story.authorId !== this.currentProfileId;
    }

    trackPostById(_: number, post: PostDto): string {
        return post.id;
    }

    openComposer(): void {
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
    }

    toggleCreateMenu(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.createMenuOpen = !this.createMenuOpen;
    }

    closeCreateMenu(): void {
        this.createMenuOpen = false;
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        if (!this.createMenuOpen) {
            return;
        }

        const clickedInsideMenu = event.composedPath().some((node) => {
            return node instanceof HTMLElement && node.classList.contains('hero-create-menu');
        });

        if (!clickedInsideMenu) {
            this.createMenuOpen = false;
        }
    }

    @HostListener('document:keydown.escape')
    onEscapePressed(): void {
        this.createMenuOpen = false;
    }

    openStoryComposer(): void {
        if (this.postingStory) {
            return;
        }

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
        this.markStorySensitive = false;
        this.storyScheduledPublishLocal = '';
        this.storyComposerStep = 1;
        this.storyComposerError = '';
        void this.applyPendingStoryDraftAsync(this.session.consumePendingStoryComposerDraft());
    }

    openReelComposer(): void {
        this.createMenuOpen = false;
        this.showComposer = false;
        this.showStoryComposer = false;
        this.showReelComposer = true;
    }

    openBlogStudio(): void {
        this.createMenuOpen = false;
        void this.router.navigate(['/blogs/studio']);
    }

    onReelComposerClosed(): void {
        this.showReelComposer = false;
    }

    onReelComposerPublished(): void {
        this.selectedContentTab = 'reels';
        void this.load();
    }

    onReelUploadStatusChanged(status: ReelUploadStatusEvent): void {
        this.reelUploadStatus = status;

        if (this.reelUploadStatusHideTimeoutId !== null) {
            window.clearTimeout(this.reelUploadStatusHideTimeoutId);
            this.reelUploadStatusHideTimeoutId = null;
        }

        if (status.state === 'uploading') {
            return;
        }

        this.reelUploadStatusHideTimeoutId = window.setTimeout(() => {
            if (this.reelUploadStatus?.state === status.state) {
                this.reelUploadStatus = null;
            }

            this.reelUploadStatusHideTimeoutId = null;
        }, 5000);
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

    ngOnDestroy(): void {
        if (this.reelUploadStatusHideTimeoutId !== null) {
            window.clearTimeout(this.reelUploadStatusHideTimeoutId);
            this.reelUploadStatusHideTimeoutId = null;
        }

        if (this.composerCloseTimerId !== null) {
            window.clearTimeout(this.composerCloseTimerId);
            this.composerCloseTimerId = null;
        }

        if (this.storyComposerCloseTimerId !== null) {
            window.clearTimeout(this.storyComposerCloseTimerId);
            this.storyComposerCloseTimerId = null;
        }

        this.detachStoryFrameDragListeners();
        this.detachStoryTrimDragListeners();
        this.closeCustomFeedHandleSuggestions();
        this.closeCustomFeedHashtagSuggestions();
        this.clearStoryMediaSelection();
    }

    onComposerCanceled(): void {
        this.beginPostComposerClose();
    }

    async onComposerPosted(): Promise<void> {
        this.beginPostComposerClose();
        await this.load();
    }

    cancelStoryComposer(): void {
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
        }, FeedPageComponent.ComposerCloseAnimationDurationMs);
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
            this.clearStoryMediaSelection();
            this.storyComposerError = '';
            this.storyComposerCloseTimerId = null;
        }, FeedPageComponent.ComposerCloseAnimationDurationMs);
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
                    this.storyTrimEndSeconds = Math.min(this.storyMediaDurationSeconds, FeedPageComponent.StoryMaxTrimDurationSeconds);
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

        if (input) {
            input.value = '';
        }
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
            const maxEnd = Math.min(parsedDuration, this.storyTrimStartSeconds + FeedPageComponent.StoryMaxTrimDurationSeconds);
            this.storyTrimEndSeconds = Math.max(this.storyTrimStartSeconds + 1, Math.min(defaultEnd, maxEnd));
            if (this.storyTrimEndSeconds - this.storyTrimStartSeconds > FeedPageComponent.StoryMaxTrimDurationSeconds) {
                this.storyTrimEndSeconds = Math.min(parsedDuration, this.storyTrimStartSeconds + FeedPageComponent.StoryMaxTrimDurationSeconds);
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

        const minStart = Math.max(0, this.storyTrimEndSeconds - FeedPageComponent.StoryMaxTrimDurationSeconds);
        this.storyTrimStartSeconds = Math.max(minStart, Math.min(next, this.storyTrimEndSeconds - 1));
        this.syncStoryPreviewToTrimRange();
    }

    onStoryTrimEndChanged(rawValue: string): void {
        const next = Number(rawValue);
        if (Number.isNaN(next) || !this.storyMediaIsVideo) {
            return;
        }

        const maxEnd = Math.min(this.storyMediaDurationSeconds, this.storyTrimStartSeconds + FeedPageComponent.StoryMaxTrimDurationSeconds);
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
        const frameHeightPercent = FeedPageComponent.StoryCropFrameHeightPercent;
        const frameWidthPercent = frameHeightPercent * (9 / 16) * (9 / 16);
        const maxCenterShiftX = Math.max(0, (100 - frameWidthPercent) / 2);
        const maxCenterShiftY = Math.max(0, (100 - frameHeightPercent) / 2);
        const offsetLimit = FeedPageComponent.StoryFrameOffsetLimit;
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
                if (!saveAsDraft) {
                    await this.recordEngagementActivity();
                }
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

    private async applyPendingStoryDraftAsync(draft: PendingStoryComposerDraft | null): Promise<void> {
        if (!draft) {
            return;
        }

        this.markStorySensitive = draft.markSensitive === true;
        this.storyScheduledPublishLocal = draft.scheduledPublishLocal ?? '';

        if (!draft.storyMediaFile) {
            this.storyComposerError = 'Story media could not be restored. Choose media to continue.';
            this.storyComposerStep = 1;
            return;
        }

        this.clearStoryMediaSelection();
        this.storyMediaFile = draft.storyMediaFile;
        this.storyMediaPreviewUrl = URL.createObjectURL(draft.storyMediaFile);
        this.storyMediaObjectUrl = this.storyMediaPreviewUrl;
        this.storyMediaIsVideo = draft.storyMediaFile.type.startsWith('video/');
        this.storyPreviewReady = !this.storyMediaIsVideo;
        this.storyComposerStep = 2;
        this.storyComposerError = '';
        this.storyTrimStartSeconds = 0;
        this.storyTrimEndSeconds = 0;
        this.storySourceMediaWidth = 0;
        this.storySourceMediaHeight = 0;

        if (!this.storyMediaIsVideo) {
            return;
        }

        try {
            this.storyMediaDurationSeconds = await this.readVideoDurationSeconds(draft.storyMediaFile);
            this.storyTrimEndSeconds = Math.min(this.storyMediaDurationSeconds, FeedPageComponent.StoryMaxTrimDurationSeconds);
            void this.generateStoryTrimPreviewOptions(draft.storyMediaFile, this.storyMediaDurationSeconds);
        } catch {
            this.storyComposerError = 'Could not restore story media. Choose media again.';
            this.storyComposerStep = 1;
            this.clearStoryMediaSelection();
        }
    }

    async load(): Promise<void> {
        this.syncCompactFeedPreference();

        if (this.loadInFlight) {
            this.reloadQueued = true;
            return;
        }

        this.loadInFlight = true;

        try {
            do {
                this.reloadQueued = false;
                this.ngZone.run(() => {
                    this.loading = true;
                    this.reelsLoading = true;
                    this.error = '';
                    this.reelsError = '';
                });

                const mode = this.selectedFeedMode;
                const customFeedId = this.selectedCustomFeedId ?? undefined;
                const profileHandle = (this.session.profile?.handle ?? '').trim();
                const [postsResult, reelsResult, profileSummaryResult] = await Promise.allSettled([
                    this.session.loadFeedAsync(mode, customFeedId),
                    this.session.loadReelFeedAsync(20, mode, customFeedId),
                    profileHandle ? this.session.loadProfileActivitySummaryAsync(profileHandle) : Promise.resolve(null)
                ]);

                this.ngZone.run(() => {
                    if (postsResult.status === 'fulfilled') {
                        this.feed = postsResult.value.filter(post => !this.isFeedAuthorMuted(post.authorHandle));
                    } else {
                        this.feed = [];
                        this.error = 'Could not load your feed right now. Please try again.';
                    }

                    if (reelsResult.status === 'fulfilled') {
                        this.reels = reelsResult.value.filter(reel => !this.isFeedAuthorMuted(reel.authorHandle));
                    } else {
                        this.reels = [];
                        this.reelsError = 'Could not load reels right now. Please try again.';
                    }

                    if (profileSummaryResult.status === 'fulfilled') {
                        this.profileActivitySummary = profileSummaryResult.value;
                    } else {
                        this.profileActivitySummary = null;
                    }

                    this.loading = false;
                    this.reelsLoading = false;
                });

                if (postsResult.status === 'fulfilled' || reelsResult.status === 'fulfilled') {
                    try {
                        await this.session.loadSavedStatusAsync(
                            this.feed.map(post => post.id),
                            this.reels.map(reel => reel.id)
                        );
                    } catch {
                        // Non-blocking; feed should still render even if saved-status lookup fails.
                    }
                }

                await this.loadStories(mode, customFeedId);
            } while (this.reloadQueued);
        } finally {
            this.hasLoadedAtLeastOnce = true;
            this.loadInFlight = false;
        }
    }

    selectFeedMode(mode: FeedMode): void {
        if (this.selectedFeedMode === mode) {
            return;
        }

        this.selectedFeedMode = mode;
        this.closeStoryViewer();
        void this.load();
    }

    selectCustomFeed(customFeedId: string | null): void {
        if (this.selectedCustomFeedId === customFeedId) {
            return;
        }

        this.selectedCustomFeedId = customFeedId;
        this.closeStoryViewer();
        void this.load();
    }

    openCreateCustomFeedModal(): void {
        this.customFeedModalMode = 'create';
        this.customFeedDraftName = '';
        this.customFeedDraftHandles = '';
        this.customFeedDraftHashtags = '';
        this.customFeedModalError = '';
        this.closeCustomFeedHandleSuggestions();
        this.closeCustomFeedHashtagSuggestions();
        this.showCustomFeedModal = true;
    }

    openEditCustomFeedModal(): void {
        const selectedFeed = this.selectedCustomFeed;
        if (!selectedFeed) {
            return;
        }

        this.customFeedModalMode = 'edit';
        this.customFeedDraftName = selectedFeed.name;
        this.customFeedDraftHandles = selectedFeed.authorHandles
            .map(handle => handle.startsWith('!') ? `!@${handle.slice(1)}` : `@${handle}`)
            .join(', ');
        this.customFeedDraftHashtags = selectedFeed.hashtags.map(tag => `#${tag}`).join(', ');
        this.customFeedModalError = '';
        this.closeCustomFeedHandleSuggestions();
        this.closeCustomFeedHashtagSuggestions();
        this.showCustomFeedModal = true;
    }

    closeCustomFeedModal(): void {
        if (this.savingCustomFeed) {
            return;
        }

        this.showCustomFeedModal = false;
        this.customFeedModalError = '';
        this.closeCustomFeedHandleSuggestions();
        this.closeCustomFeedHashtagSuggestions();
    }

    onCustomFeedHandlesChanged(value: string): void {
        this.customFeedDraftHandles = value;

        const query = this.extractCustomFeedHandleQuery(value);
        if (!query) {
            this.closeCustomFeedHandleSuggestions();
            return;
        }

        this.searchCustomFeedHandleSuggestions(query);
    }

    onCustomFeedHandlesFocus(): void {
        const query = this.extractCustomFeedHandleQuery(this.customFeedDraftHandles);
        if (!query) {
            return;
        }

        this.searchCustomFeedHandleSuggestions(query);
    }

    onCustomFeedHandlesBlur(): void {
        window.setTimeout(() => {
            this.closeCustomFeedHandleSuggestions();
        }, 120);
    }

    onCustomFeedHandlesEnter(event: Event): void {
        event.preventDefault();

        if (this.customFeedHandleSuggestions.length > 0) {
            this.selectCustomFeedHandleSuggestion(this.customFeedHandleSuggestions[0]);
            return;
        }

        const query = this.extractCustomFeedHandleQuery(this.customFeedDraftHandles);
        if (!query) {
            return;
        }

        this.applyCustomFeedHandle(query, this.isCustomFeedHandleExclusionToken(this.customFeedDraftHandles));
    }

    selectCustomFeedHandleSuggestion(profile: ProfileDto): void {
        this.applyCustomFeedHandle(profile.handle, this.isCustomFeedHandleExclusionToken(this.customFeedDraftHandles));
    }

    onCustomFeedHashtagsChanged(value: string): void {
        this.customFeedDraftHashtags = value;

        const query = this.extractCustomFeedHashtagQuery(value);
        if (!query) {
            this.closeCustomFeedHashtagSuggestions();
            return;
        }

        this.searchCustomFeedHashtagSuggestions(query);
    }

    onCustomFeedHashtagsFocus(): void {
        const query = this.extractCustomFeedHashtagQuery(this.customFeedDraftHashtags);
        if (!query) {
            return;
        }

        this.searchCustomFeedHashtagSuggestions(query);
    }

    onCustomFeedHashtagsBlur(): void {
        window.setTimeout(() => {
            this.closeCustomFeedHashtagSuggestions();
        }, 120);
    }

    onCustomFeedHashtagsEnter(event: Event): void {
        event.preventDefault();

        if (this.customFeedHashtagSuggestions.length > 0) {
            this.selectCustomFeedHashtagSuggestion(this.customFeedHashtagSuggestions[0]);
            return;
        }

        const query = this.extractCustomFeedHashtagQuery(this.customFeedDraftHashtags);
        if (!query) {
            return;
        }

        this.applyCustomFeedHashtag(query);
    }

    selectCustomFeedHashtagSuggestion(hashtag: HashtagSearchResultDto): void {
        this.applyCustomFeedHashtag(hashtag.tag);
    }

    requestDeleteSelectedCustomFeed(): void {
        if (!this.selectedCustomFeed) {
            return;
        }

        this.pendingDeleteCustomFeed = this.selectedCustomFeed;
    }

    cancelDeleteCustomFeed(): void {
        if (this.deletingCustomFeed) {
            return;
        }

        this.pendingDeleteCustomFeed = null;
    }

    async confirmDeleteCustomFeed(): Promise<void> {
        const selectedFeed = this.pendingDeleteCustomFeed;
        if (!selectedFeed || this.deletingCustomFeed) {
            return;
        }

        this.deletingCustomFeed = true;
        try {
            await this.session.deleteCustomFeedAsync(selectedFeed.id);
            this.customFeeds = this.sortCustomFeeds(this.customFeeds.filter(feed => feed.id !== selectedFeed.id));
            this.pendingDeleteCustomFeed = null;

            if (this.selectedCustomFeedId === selectedFeed.id) {
                this.selectedCustomFeedId = null;
                await this.load();
            }
        } catch {
            this.error = 'Could not delete this custom feed right now.';
        } finally {
            this.deletingCustomFeed = false;
        }
    }

    async saveCustomFeed(): Promise<void> {
        if (this.savingCustomFeed) {
            return;
        }

        const name = this.customFeedDraftName.trim();
        const authorHandles = this.customFeedDraftHandleValues;
        const hashtags = this.customFeedDraftHashtagValues;
        if (!name || (authorHandles.length === 0 && hashtags.length === 0)) {
            this.customFeedModalError = 'Add a name and at least one handle or hashtag.';
            return;
        }

        this.savingCustomFeed = true;
        this.customFeedModalError = '';

        try {
            const request = { name, authorHandles, hashtags };
            const saved = this.customFeedModalMode === 'edit' && this.selectedCustomFeedId
                ? await this.session.updateCustomFeedAsync(this.selectedCustomFeedId, request)
                : await this.session.createCustomFeedAsync(request);

            const nextFeeds = this.customFeedModalMode === 'edit'
                ? this.customFeeds.map(feed => feed.id === saved.id ? saved : feed)
                : [saved, ...this.customFeeds.filter(feed => feed.id !== saved.id)];

            this.customFeeds = this.sortCustomFeeds(nextFeeds);
            this.selectedCustomFeedId = saved.id;
            this.showCustomFeedModal = false;
            await this.load();
        } catch {
            this.customFeedModalError = 'Could not save this custom feed right now.';
        } finally {
            this.savingCustomFeed = false;
        }
    }

    selectContentTab(tab: 'posts' | 'reels'): void {
        this.selectedContentTab = tab;
    }

    onContentTabChanged(tabId: string): void {
        if (tabId !== 'posts' && tabId !== 'reels') {
            return;
        }

        this.selectContentTab(tabId);
    }

    openEngagementStreakAction(): void {
        this.openComposer();
    }

    openDraftsPage(): void {
        void this.router.navigate(['/drafts']);
    }

    dismissFollowSuggestionsCard(): void {
        this.followSuggestionsDismissed = true;
        try {
            localStorage.setItem(this.followSuggestionsDismissStorageKey, '1');
        } catch {
        }
    }

    dismissHashtagSuggestionsCard(): void {
        this.hashtagSuggestionsDismissed = true;
        try {
            localStorage.setItem(this.hashtagSuggestionsDismissStorageKey, '1');
        } catch {
        }
    }

    async followSuggestedProfile(profile: ProfileDto): Promise<void> {
        if (!profile?.id || this.followingSuggestionProfileId) {
            return;
        }

        this.followingSuggestionProfileId = profile.id;
        try {
            await this.session.followAsync(profile.id);
            this.followSuggestions = this.followSuggestions.filter(item => item.id !== profile.id);
            this.profileActivitySummary = {
                postCount: this.profileActivitySummary?.postCount ?? 0,
                followerCount: this.profileActivitySummary?.followerCount ?? 0,
                followingCount: (this.profileActivitySummary?.followingCount ?? 0) + 1
            };
            void this.refreshFollowSuggestionsAsync();
        } finally {
            this.followingSuggestionProfileId = null;
        }
    }

    async followSuggestedHashtag(tag: string): Promise<void> {
        const normalizedTag = (tag ?? '').trim().replace(/^#/, '').toLowerCase();
        if (!normalizedTag || this.followingHashtagTag) {
            return;
        }

        this.followingHashtagTag = normalizedTag;
        try {
            const followed = await this.session.followHashtagAsync(normalizedTag);
            const nextTag = (followed.tag ?? normalizedTag).trim().replace(/^#/, '').toLowerCase();
            this.followedHashtagTags = [nextTag, ...this.followedHashtagTags.filter(item => item !== nextTag)];
            this.hashtagSuggestions = this.hashtagSuggestions.filter(item => item.tag.trim().replace(/^#/, '').toLowerCase() !== nextTag);
            this.session.message = this.translate.instant('discover.status.followingHashtag', { tag: nextTag });
            void this.refreshHashtagSuggestionsAsync();
        } finally {
            this.followingHashtagTag = null;
        }
    }

    dismissProfileSetupCard(): void {
        this.profileSetupDismissed = true;
        try {
            localStorage.setItem(this.profileSetupDismissStorageKey, '1');
        } catch {
        }
    }

    runProfileSetupAction(action: ProfileSetupChecklistItem['action']): void {
        if (action === 'settings') {
            void this.router.navigate(['/settings'], { fragment: 'settings-section-profile' });
            return;
        }

        if (action === 'discover') {
            void this.router.navigate(['/discover']);
            return;
        }

        this.openComposer();
    }

    openHiddenCreatorsSettings(): void {
        void this.router.navigate(['/settings'], { fragment: 'settings-section-safety' });
    }

    openStoryGroup(group: StoryGroupDto): void {
        if (!group.stories.length) {
            return;
        }

        this.activeStoryGroup = group;
        this.activeStoryIndex = this.getNewestUnseenStoryIndex(group.stories);
        this.persistActiveStoryResume();
        void this.markActiveStoryViewed();
    }

    hasActiveStoryForHandle(handle: string): boolean {
        return this.storyPresence.hasActiveStoryForHandle(this.storyGroups, handle);
    }

    hasUnseenStoryForHandle(handle: string): boolean {
        return this.storyPresence.hasUnseenStoryForHandle(this.storyGroups, handle);
    }

    openProfileOrStory(handle: string, event?: MouseEvent): void {
        event?.preventDefault();
        event?.stopPropagation();

        const normalized = handle.trim().toLowerCase();
        const group = this.storyGroups.find(item => item.authorHandle.trim().toLowerCase() === normalized);
        if (group) {
            this.openStoryGroup(group);
            return;
        }

        void this.router.navigate(['/users', handle]);
    }

    closeStoryViewer(): void {
        this.persistActiveStoryResume();
        this.activeStoryGroup = null;
        this.activeStoryIndex = 0;
        this.storyViewerError = '';
        this.deletingStory = false;
        this.pendingDeleteStoryId = null;
        this.sendingStoryReply = false;
        this.sharingStoryMessage = false;
        this.pendingShareStory = null;
        this.sharingStoryId = null;
    }

    showPreviousStory(): void {
        if (!this.hasPreviousStory) {
            return;
        }

        this.activeStoryIndex -= 1;
        this.persistActiveStoryResume();
        void this.markActiveStoryViewed();
    }

    showNextStory(): void {
        if (!this.hasNextStory) {
            this.closeStoryViewer();
            return;
        }

        this.activeStoryIndex += 1;
        this.storyViewerError = '';
        this.persistActiveStoryResume();
        void this.markActiveStoryViewed();
    }

    onReelPlaybackProgress(event: ReelPlaybackProgressEvent): void {
        if (this.session.isAuthenticated()) {
            const watchedSeconds = event.completed
                ? Math.max(1, Math.min(event.durationSeconds, 6))
                : Math.max(0.2, Math.min(2.5, event.durationSeconds > 0 ? (event.positionSeconds / Math.max(event.durationSeconds, 1)) : 0.5));

            void this.session.trackReelPlaybackAsync(event.reelId, event.positionSeconds, watchedSeconds, event.completed);
        }
    }

    isStoryLiked(storyId: string): boolean {
        return this.likedStoryIds.has(storyId);
    }

    private syncCompactFeedPreference(): void {
        const stored = localStorage.getItem(this.prefsStorageKey);
        if (!stored) {
            this.compactFeedEnabled = false;
            return;
        }

        try {
            const parsed = JSON.parse(stored) as { compactFeed?: boolean };
            this.compactFeedEnabled = !!parsed.compactFeed;
        } catch {
            this.compactFeedEnabled = false;
        }
    }

    private loadProfileSetupDismissPreference(): void {
        try {
            this.profileSetupDismissed = localStorage.getItem(this.profileSetupDismissStorageKey) === '1';
        } catch {
            this.profileSetupDismissed = false;
        }
    }

    private loadFollowSuggestionsDismissPreference(): void {
        try {
            this.followSuggestionsDismissed = localStorage.getItem(this.followSuggestionsDismissStorageKey) === '1';
        } catch {
            this.followSuggestionsDismissed = false;
        }
    }

    private loadHashtagSuggestionsDismissPreference(): void {
        try {
            this.hashtagSuggestionsDismissed = localStorage.getItem(this.hashtagSuggestionsDismissStorageKey) === '1';
        } catch {
            this.hashtagSuggestionsDismissed = false;
        }
    }

    private isFeedAuthorMuted(handle: string): boolean {
        const normalizedHandle = this.normalizeFeedHandle(handle);
        return !!normalizedHandle && this.mutedFeedAuthorHandles.has(normalizedHandle);
    }

    private normalizeFeedHandle(handle: string): string {
        return (handle ?? '').trim().toLowerCase();
    }

    private loadMutedFeedAuthorsPreference(): void {
        try {
            const stored = localStorage.getItem(this.mutedFeedAuthorsStorageKey);
            if (!stored) {
                this.mutedFeedAuthorHandles = new Set<string>();
                return;
            }

            const parsed = JSON.parse(stored) as string[];
            if (!Array.isArray(parsed)) {
                this.mutedFeedAuthorHandles = new Set<string>();
                return;
            }

            this.mutedFeedAuthorHandles = new Set(parsed
                .map(value => this.normalizeFeedHandle(value))
                .filter(value => !!value));
        } catch {
            this.mutedFeedAuthorHandles = new Set<string>();
        }
    }

    private persistMutedFeedAuthorsPreference(): void {
        try {
            localStorage.setItem(this.mutedFeedAuthorsStorageKey, JSON.stringify(Array.from(this.mutedFeedAuthorHandles)));
        } catch {
        }
    }

    private loadEngagementStreakState(): void {
        try {
            const stored = localStorage.getItem(this.engagementStreakStorageKey);
            if (!stored) {
                this.engagementStreakState = { current: 0, best: 0, lastActiveDate: '' };
                return;
            }

            const parsed = JSON.parse(stored) as Partial<EngagementStreakState>;
            this.engagementStreakState = {
                current: Math.max(0, Number(parsed.current) || 0),
                best: Math.max(0, Number(parsed.best) || 0),
                lastActiveDate: typeof parsed.lastActiveDate === 'string' ? parsed.lastActiveDate : ''
            };
        } catch {
            this.engagementStreakState = { current: 0, best: 0, lastActiveDate: '' };
        }
    }

    private persistEngagementStreakState(): void {
        try {
            localStorage.setItem(this.engagementStreakStorageKey, JSON.stringify(this.engagementStreakState));
        } catch {
        }
    }

    private applyEngagementStreakDto(dto: EngagementStreakDto): void {
        this.engagementStreakState = {
            current: Math.max(0, Number(dto.currentDays) || 0),
            best: Math.max(0, Number(dto.bestDays) || 0),
            lastActiveDate: typeof dto.lastActiveDate === 'string' ? dto.lastActiveDate : ''
        };
        this.persistEngagementStreakState();
    }

    private async syncEngagementStreakFromApi(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            return;
        }

        try {
            const streak = await this.session.loadEngagementStreakAsync();
            this.applyEngagementStreakDto(streak);
        } catch {
        }
    }

    private async refreshDraftNudgeState(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.hasPostDraft = false;
            this.hasReelDraft = false;
            this.hasStoryDraft = false;
            return;
        }

        const [postDraftsResult, reelDraftsResult, storyDraftsResult] = await Promise.allSettled([
            this.session.loadMyPostDraftsAsync(1),
            this.session.loadMyReelDraftsAsync(1),
            this.session.loadMyStoryDraftsAsync(1)
        ]);

        this.hasPostDraft = postDraftsResult.status === 'fulfilled' && postDraftsResult.value.length > 0;
        this.hasReelDraft = reelDraftsResult.status === 'fulfilled' && reelDraftsResult.value.length > 0;
        this.hasStoryDraft = storyDraftsResult.status === 'fulfilled' && storyDraftsResult.value.length > 0;
    }

    private async refreshFollowSuggestionsAsync(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.followSuggestions = [];
            return;
        }

        try {
            const suggestions = await this.session.loadFollowSuggestionsAsync(4);
            const merged = [...suggestions.relevant, ...suggestions.following];
            const currentProfileId = this.session.profile?.id;
            const seen = new Set<string>();
            this.followSuggestions = merged
                .filter(profile => {
                    if (!profile.id || profile.id === currentProfileId || seen.has(profile.id)) {
                        return false;
                    }

                    seen.add(profile.id);
                    return true;
                })
                .slice(0, 3);
        } catch {
            this.followSuggestions = [];
        }
    }

    private async refreshHashtagSuggestionsAsync(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.hashtagSuggestions = [];
            this.followedHashtagTags = [];
            return;
        }

        const [trendingResult, followedResult] = await Promise.allSettled([
            this.session.loadTrendingHashtagsAsync(8),
            this.session.loadFollowedHashtagsAsync(20)
        ]);

        const followedTags = followedResult.status === 'fulfilled'
            ? followedResult.value
                .map(item => (item.tag ?? '').trim().replace(/^#/, '').toLowerCase())
                .filter(tag => !!tag)
            : [];

        this.followedHashtagTags = followedTags;

        if (trendingResult.status !== 'fulfilled') {
            this.hashtagSuggestions = [];
            return;
        }

        const followedSet = new Set(followedTags);
        this.hashtagSuggestions = trendingResult.value
            .filter(item => {
                const normalizedTag = (item.tag ?? '').trim().replace(/^#/, '').toLowerCase();
                return !!normalizedTag && !followedSet.has(normalizedTag);
            })
            .slice(0, 5);
    }

    private recordEngagementActivityLocal(today: string): void {
        if (this.engagementStreakState.lastActiveDate === today) {
            return;
        }

        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = this.getLocalDateKey(yesterdayDate);

        if (this.engagementStreakState.lastActiveDate === yesterday) {
            this.engagementStreakState.current = Math.max(1, this.engagementStreakState.current) + 1;
        } else {
            this.engagementStreakState.current = 1;
        }

        this.engagementStreakState.lastActiveDate = today;
        this.engagementStreakState.best = Math.max(this.engagementStreakState.best, this.engagementStreakState.current);
        this.persistEngagementStreakState();
    }

    private async recordEngagementActivity(): Promise<void> {
        const today = this.getLocalDateKey();

        if (!this.session.isAuthenticated()) {
            this.recordEngagementActivityLocal(today);
            return;
        }

        if (this.engagementStreakState.lastActiveDate === today) {
            return;
        }

        try {
            const updated = await this.session.trackEngagementAsync(today);
            this.applyEngagementStreakDto(updated);
        } catch {
            this.recordEngagementActivityLocal(today);
        }
    }

    private getLocalDateKey(value = new Date()): string {
        const year = value.getFullYear();
        const month = `${value.getMonth() + 1}`.padStart(2, '0');
        const day = `${value.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
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
            this.removeStoryFromCollections(story.id);
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

    async shareStoryAsMessage(story: StoryDto): Promise<void> {
        if (!openStoryShareModal(this, story, this.sharingStoryMessage)) {
            return;
        }

        this.storyViewerError = '';
    }

    openPostReport(post: PostDto): void {
        if (!this.currentProfileId || post.authorId === this.currentProfileId || this.reportingContent) {
            return;
        }

        this.pendingReportTarget = { kind: 'post', id: post.id, handle: post.authorHandle };
        this.showContentReportModal = true;
    }

    openReelReport(reel: ReelDto): void {
        if (!this.currentProfileId || reel.authorId === this.currentProfileId || this.reportingContent) {
            return;
        }

        this.pendingReportTarget = { kind: 'reel', id: reel.id, handle: reel.authorHandle };
        this.showContentReportModal = true;
    }

    openStoryReport(story: StoryDto): void {
        if (!this.currentProfileId || story.authorId === this.currentProfileId || this.reportingContent) {
            return;
        }

        this.pendingReportTarget = { kind: 'story', id: story.id, handle: story.authorHandle };
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

        this.pendingReportTarget = { kind: 'comment', id: comment.id, handle: comment.authorHandle };
        this.showContentReportModal = true;
    }

    openReelCommentReport(event: { reel: ReelDto; comment: { id: string; authorId: string; authorHandle: string } }): void {
        if (!this.currentProfileId || this.reportingContent) {
            return;
        }

        if (event.comment.authorId === this.currentProfileId) {
            return;
        }

        this.pendingReportTarget = { kind: 'reel-comment', id: event.comment.id, handle: event.comment.authorHandle };
        this.showContentReportModal = true;
    }

    closeContentReportModal(): void {
        if (this.reportingContent) {
            return;
        }

        this.showContentReportModal = false;
        this.pendingReportTarget = null;
    }

    async submitContentReport(payload: { reason: string; details?: string }): Promise<void> {
        const target = this.pendingReportTarget;
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
        this.reelsError = '';
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
            this.pendingReportTarget = null;
        } catch {
            const message = 'Could not submit report right now.';
            if (target.kind === 'post' || target.kind === 'comment') {
                this.error = message;
            } else if (target.kind === 'reel' || target.kind === 'reel-comment') {
                this.reelsError = message;
            } else {
                this.storyViewerError = message;
            }
        } finally {
            this.reportingContent = false;
        }
    }

    cancelStoryShareModal(): void {
        cancelStoryShareModalState(this);
    }

    async submitStoryShareAsMessage(request: ShareReelMessageSubmit): Promise<void> {
        const story = this.pendingShareStory;
        if (!story) {
            return;
        }

        const succeeded = await this.executeStoryShareToChat(story, request);
        if (succeeded) {
            this.cancelStoryShareModal();
        }
    }

    get pendingShareStoryAsReel(): ReelDto | null {
        const story = this.pendingShareStory;
        if (!story) {
            return null;
        }

        return {
            id: story.id,
            authorId: story.authorId,
            authorHandle: story.authorHandle,
            authorImageUrl: story.authorImageUrl,
            caption: story.caption,
            videoUrl: story.mediaUrl,
            thumbnailUrl: this.isStoryVideo(story) ? undefined : story.mediaUrl,
            durationSeconds: 0,
            createdAtUtc: story.createdAtUtc,
            likeCount: 0,
            likedByMe: false,
            comments: []
        };
    }

    private async executeStoryShareToChat(story: StoryDto, request: ShareReelMessageSubmit): Promise<boolean> {
        const state = {
            sharingStoryId: this.sharingStoryId,
            sharingStoryMessage: this.sharingStoryMessage,
            errorMessage: this.storyViewerError
        };

        const succeeded = await executeStoryShareToChatCore(
            state,
            this.session,
            story,
            request,
            this.buildSharedStoryMarker(story),
            'Could not share this story as a message right now.'
        );

        this.sharingStoryId = state.sharingStoryId;
        this.sharingStoryMessage = state.sharingStoryMessage;
        this.storyViewerError = state.errorMessage;
        return succeeded;
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
        if (this.repostCountSource === this.feed) {
            return;
        }

        this.repostCountSource = this.feed;
        this.repostCountsByPostId = buildSharedPostReferenceCounts(this.feed);
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

    get savedReelIds(): string[] {
        return Array.from(this.session.savedReelIds.keys());
    }

    isReelSaved(reelId: string): boolean {
        return this.session.isReelSaved(reelId);
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

    markPostNotInterested(post: PostDto): void {
        const normalizedHandle = this.normalizeFeedHandle(post.authorHandle);
        if (!normalizedHandle) {
            return;
        }

        if (!this.mutedFeedAuthorHandles.has(normalizedHandle)) {
            this.mutedFeedAuthorHandles.add(normalizedHandle);
            this.persistMutedFeedAuthorsPreference();
        }

        this.feed = this.feed.filter(item => this.normalizeFeedHandle(item.authorHandle) !== normalizedHandle);
        this.reels = this.reels.filter(item => this.normalizeFeedHandle(item.authorHandle) !== normalizedHandle);
        this.storyGroups = this.storyGroups.filter(item => this.normalizeFeedHandle(item.authorHandle) !== normalizedHandle);
        this.tryOpenPendingStoryHandle();
        this.session.message = this.translate.instant('homeFeed.tuning.fewerPostsNotice', { handle: post.authorHandle });
    }

    requestPostNotInterested(post: PostDto): void {
        if (!post?.id) {
            return;
        }

        this.pendingNotInterestedPost = post;
    }

    cancelPostNotInterested(): void {
        this.pendingNotInterestedPost = null;
    }

    confirmPostNotInterested(): void {
        const post = this.pendingNotInterestedPost;
        if (!post) {
            return;
        }

        this.pendingNotInterestedPost = null;
        this.markPostNotInterested(post);
    }

    markReelNotInterested(reel: ReelDto): void {
        const normalizedHandle = this.normalizeFeedHandle(reel.authorHandle);
        if (!normalizedHandle) {
            return;
        }

        if (!this.mutedFeedAuthorHandles.has(normalizedHandle)) {
            this.mutedFeedAuthorHandles.add(normalizedHandle);
            this.persistMutedFeedAuthorsPreference();
        }

        this.feed = this.feed.filter(item => this.normalizeFeedHandle(item.authorHandle) !== normalizedHandle);
        this.reels = this.reels.filter(item => this.normalizeFeedHandle(item.authorHandle) !== normalizedHandle);
        this.storyGroups = this.storyGroups.filter(item => this.normalizeFeedHandle(item.authorHandle) !== normalizedHandle);
        this.tryOpenPendingStoryHandle();
        this.session.message = this.translate.instant('homeFeed.tuning.fewerReelsNotice', { handle: reel.authorHandle });
    }

    requestReelNotInterested(reel: ReelDto): void {
        if (!reel?.id) {
            return;
        }

        this.pendingNotInterestedReel = reel;
    }

    cancelReelNotInterested(): void {
        this.pendingNotInterestedReel = null;
    }

    confirmReelNotInterested(): void {
        const reel = this.pendingNotInterestedReel;
        if (!reel) {
            return;
        }

        this.pendingNotInterestedReel = null;
        this.markReelNotInterested(reel);
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

    async toggleReelLike(reel: ReelDto): Promise<void> {
        if (this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.reactingReelId = reel.id;
        try {
            const updated = await this.reelInteractions.toggleLike(reel.id);
            this.reels = this.reels.map(item => item.id === updated.id ? updated : item);
            this.recordEngagementActivity();
        } catch {
            this.reelsError = 'Could not update reel like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    async addReelComment(event: ReelCommentCreateEvent): Promise<void> {
        const { reel, content, parentCommentId } = event;
        if (this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.reelsError = '';
        try {
            const updated = await this.reelInteractions.addComment(reel.id, content, parentCommentId ?? null);
            this.pendingDeleteReelComment = null;
            this.reels = this.reels.map(item => item.id === updated.id ? updated : item);
            this.recordEngagementActivity();
        } catch {
            this.reelsError = 'Could not add reel comment right now.';
        } finally {
            this.commentingReelId = null;
        }
    }

    async updateReelComment(event: ReelCommentUpdateEvent): Promise<void> {
        const { reel, commentId, content } = event;
        if (this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.reelsError = '';
        try {
            const updated = await this.reelInteractions.updateComment(reel.id, commentId, content);
            this.reels = this.reels.map(item => item.id === updated.id ? updated : item);
        } catch {
            this.reelsError = 'Could not update reel comment right now.';
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

        const reel = this.reels.find(item => item.id === pending.reelId);
        if (!reel) {
            this.pendingDeleteReelComment = null;
            return;
        }

        this.deletingReelCommentId = pending.commentId;
        this.commentingReelId = pending.reelId;
        this.reelsError = '';
        try {
            const updated = await this.reelInteractions.deleteComment(pending.reelId, pending.commentId);
            this.reels = this.reels.map(item => item.id === updated.id ? updated : item);
        } catch {
            this.reelsError = 'Could not delete reel comment right now.';
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
        this.reelsError = '';
        try {
            const updated = await this.reelInteractions.toggleCommentLike(reel.id, commentId);
            this.reels = this.reels.map(item => item.id === updated.id ? updated : item);
            this.recordEngagementActivity();
        } catch {
            this.reelsError = 'Could not update reel comment like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    deleteReel(reel: ReelDto): void {
        if (this.deletingReelId || !this.canManageReel(reel)) {
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
        if (!reelId || this.deletingReelId) {
            return;
        }

        const reel = this.reels.find(item => item.id === reelId);
        if (!reel || !this.canManageReel(reel)) {
            this.pendingDeleteReelId = null;
            return;
        }

        this.deletingReelId = reelId;
        this.reelsError = '';

        try {
            await this.session.deleteReelAsync(reelId);
            this.reels = this.reels.filter(item => item.id !== reelId);
        } catch {
            this.reelsError = 'Could not delete reel right now.';
        } finally {
            this.pendingDeleteReelId = null;
            this.deletingReelId = null;
        }
    }

    shareReelToChat(reel: ReelDto): void {
        openReelShareModal(this, reel);
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

    formatFeedTimestamp(utcValue: string): string {
        return formatRelativeFeedDateTime(utcValue);
    }

    private removeStoryFromCollections(storyId: string): void {
        this.storyGroups = this.storyGroups
            .map(group => ({
                ...group,
                stories: group.stories.filter(item => item.id !== storyId)
            }))
            .filter(group => group.stories.length > 0);

        const activeGroup = this.activeStoryGroup;
        if (!activeGroup) {
            return;
        }

        const nextStories = activeGroup.stories.filter(item => item.id !== storyId);
        if (!nextStories.length) {
            this.closeStoryViewer();
            return;
        }

        this.activeStoryGroup = {
            ...activeGroup,
            stories: nextStories
        };
        this.activeStoryIndex = Math.min(this.activeStoryIndex, nextStories.length - 1);
    }

    private buildSharedStoryMarker(story: StoryDto): string {
        return buildSharedStoryMarker(buildSharedStoryPreview(story));
    }

    private isStoryVideo(story: StoryDto): boolean {
        return /\.(mp4|webm|mov|m4v|ogv)(?:\?.*)?$/i.test(story.mediaUrl);
    }

    canManagePost(post: PostDto): boolean {
        return !!this.currentProfileId && post.authorId === this.currentProfileId;
    }

    canManageReel(reel: ReelDto): boolean {
        return !!this.currentProfileId && reel.authorId === this.currentProfileId;
    }

    startEdit(post: PostDto): void {
        if (!this.canManagePost(post) || this.savingPost || this.deletingPostId) {
            return;
        }

        this.editingPostId = post.id;
        this.editContent = post.content;
        this.error = '';
    }

    cancelEdit(): void {
        if (this.savingPost) {
            return;
        }

        this.editingPostId = null;
        this.editContent = '';
    }

    async saveEdit(postId: string): Promise<void> {
        if (this.savingPost || this.deletingPostId) {
            return;
        }

        this.savingPost = true;
        this.error = '';

        try {
            await this.session.updatePostAsync(postId, this.editContent);
            const updatedContent = this.editContent;
            this.feed = this.feed.map(post => post.id === postId ? { ...post, content: updatedContent } : post);
            this.cancelEdit();
        } catch {
            this.error = 'Could not update post.';
        } finally {
            this.savingPost = false;
        }
    }

    requestDeletePost(postId: string): void {
        if (this.deletingPostId || this.savingPost) {
            return;
        }

        const post = this.feed.find(item => item.id === postId);
        if (!post || !this.canManagePost(post)) {
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
        const postId = this.pendingDeletePostId;
        if (!postId || this.deletingPostId || this.savingPost) {
            return;
        }

        const post = this.feed.find(item => item.id === postId);
        if (!post || !this.canManagePost(post)) {
            this.pendingDeletePostId = null;
            return;
        }

        this.deletingPostId = postId;
        this.error = '';

        try {
            await this.session.deletePostAsync(postId);
            this.feed = this.feed.filter(existing => existing.id !== postId);
            if (this.editingPostId === postId) {
                this.cancelEdit();
            }
        } catch {
            this.error = 'Could not delete post.';
        } finally {
            this.pendingDeletePostId = null;
            this.deletingPostId = null;
        }
    }

    async sharePostToFeed(post: PostDto): Promise<void> {
        this.openShareModal(post, 'feed');
    }

    async sharePostToChat(post: PostDto): Promise<void> {
        this.openShareModal(post, 'chat');
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
            errorMessage: this.reelsError
        };

        const succeeded = await executeReelShareToChat(
            state,
            reel,
            request,
            () => this.reelInteractions.shareToChat(reel, request),
            'Could not send this reel to direct messages right now.'
        );

        this.sharingReelId = state.sharingReelId;
        this.reelsError = state.errorMessage;
        return succeeded;
    }

    private applyPostUpdate(updated: PostDto): void {
        this.feed = this.feed.map(post => post.id === updated.id ? updated : post);
    }

    private async loadStories(mode: FeedMode, customFeedId?: string): Promise<void> {
        this.ngZone.run(() => {
            this.storiesLoading = true;
            this.storiesError = '';
        });

        try {
            const loadedStoryGroups = await this.session.loadStoryFeedAsync(25, mode, customFeedId);

            this.ngZone.run(() => {
                this.storyGroups = loadedStoryGroups.filter(group => !this.isFeedAuthorMuted(group.authorHandle));
                if (this.activeStoryGroup) {
                    this.activeStoryGroup = this.storyGroups.find(group => group.authorId === this.activeStoryGroup?.authorId) ?? null;
                    if (!this.activeStoryGroup) {
                        this.activeStoryIndex = 0;
                    } else if (this.activeStoryIndex >= this.activeStoryGroup.stories.length) {
                        this.activeStoryIndex = Math.max(this.activeStoryGroup.stories.length - 1, 0);
                    }
                }

                this.tryOpenPendingStoryHandle();
            });
        } catch {
            this.ngZone.run(() => {
                this.storyGroups = [];
                this.storiesError = 'Could not load stories right now.';
            });
        } finally {
            this.ngZone.run(() => {
                this.storiesLoading = false;
            });
        }
    }

    private async loadCustomFeeds(): Promise<void> {
        try {
            const feeds = await this.session.loadCustomFeedsAsync();
            this.customFeeds = this.sortCustomFeeds(feeds);

            if (this.selectedCustomFeedId && !this.customFeeds.some(feed => feed.id === this.selectedCustomFeedId)) {
                this.selectedCustomFeedId = null;
            }
        } catch {
            this.customFeeds = [];
        }
    }

    private sortCustomFeeds(feeds: CustomFeedDto[]): CustomFeedDto[] {
        return [...feeds].sort((left, right) => Date.parse(right.updatedAtUtc) - Date.parse(left.updatedAtUtc));
    }

    private searchCustomFeedHandleSuggestions(query: string): void {
        if (this.customFeedHandleSearchDebounceId !== null) {
            window.clearTimeout(this.customFeedHandleSearchDebounceId);
            this.customFeedHandleSearchDebounceId = null;
        }

        this.customFeedHandleSuggestionsLoading = true;
        const token = ++this.customFeedHandleSearchToken;
        this.customFeedHandleSearchDebounceId = window.setTimeout(async () => {
            this.customFeedHandleSearchDebounceId = null;

            try {
                const profiles = await this.session.searchProfilesAsync(query);
                if (token !== this.customFeedHandleSearchToken) {
                    return;
                }

                const selectedHandles = new Set(this.customFeedDraftHandleValues.map(handle => handle.replace(/^!/, '').toLowerCase()));
                this.customFeedHandleSuggestions = profiles
                    .filter(profile => !selectedHandles.has(profile.handle.toLowerCase()))
                    .slice(0, 6);
                this.customFeedHandleSuggestionsOpen = this.customFeedHandleSuggestions.length > 0;
            } catch {
                if (token !== this.customFeedHandleSearchToken) {
                    return;
                }

                this.customFeedHandleSuggestions = [];
                this.customFeedHandleSuggestionsOpen = false;
            } finally {
                if (token === this.customFeedHandleSearchToken) {
                    this.customFeedHandleSuggestionsLoading = false;
                }
            }
        }, 200);
    }

    private closeCustomFeedHandleSuggestions(): void {
        this.customFeedHandleSuggestions = [];
        this.customFeedHandleSuggestionsOpen = false;
        this.customFeedHandleSuggestionsLoading = false;
        this.customFeedHandleSearchToken += 1;

        if (this.customFeedHandleSearchDebounceId !== null) {
            window.clearTimeout(this.customFeedHandleSearchDebounceId);
            this.customFeedHandleSearchDebounceId = null;
        }
    }

    private searchCustomFeedHashtagSuggestions(query: string): void {
        if (this.customFeedHashtagSearchDebounceId !== null) {
            window.clearTimeout(this.customFeedHashtagSearchDebounceId);
            this.customFeedHashtagSearchDebounceId = null;
        }

        this.customFeedHashtagSuggestionsLoading = true;
        const token = ++this.customFeedHashtagSearchToken;
        this.customFeedHashtagSearchDebounceId = window.setTimeout(async () => {
            this.customFeedHashtagSearchDebounceId = null;

            try {
                const hashtags = await this.session.searchHashtagsAsync(query);
                if (token !== this.customFeedHashtagSearchToken) {
                    return;
                }

                const selectedHashtags = new Set(this.customFeedDraftHashtagValues.map(tag => tag.toLowerCase()));
                this.customFeedHashtagSuggestions = hashtags
                    .map(item => ({
                        ...item,
                        tag: item.tag.replace(/^#+/, '').trim().toLowerCase()
                    }))
                    .filter(item => !!item.tag && !selectedHashtags.has(item.tag))
                    .slice(0, 6);
                this.customFeedHashtagSuggestionsOpen = this.customFeedHashtagSuggestions.length > 0;
            } catch {
                if (token !== this.customFeedHashtagSearchToken) {
                    return;
                }

                this.customFeedHashtagSuggestions = [];
                this.customFeedHashtagSuggestionsOpen = false;
            } finally {
                if (token === this.customFeedHashtagSearchToken) {
                    this.customFeedHashtagSuggestionsLoading = false;
                }
            }
        }, 200);
    }

    private closeCustomFeedHashtagSuggestions(): void {
        this.customFeedHashtagSuggestions = [];
        this.customFeedHashtagSuggestionsOpen = false;
        this.customFeedHashtagSuggestionsLoading = false;
        this.customFeedHashtagSearchToken += 1;

        if (this.customFeedHashtagSearchDebounceId !== null) {
            window.clearTimeout(this.customFeedHashtagSearchDebounceId);
            this.customFeedHashtagSearchDebounceId = null;
        }
    }

    private extractCustomFeedHandleQuery(value: string): string {
        const parts = value
            .split(/[,\n]+/)
            .map(part => part.trim())
            .filter(Boolean);
        const lastPart = parts.length > 0 ? parts[parts.length - 1] : '';
        return lastPart
            .replace(/^!/, '')
            .replace(/^@/, '')
            .trim()
            .toLowerCase()
            .slice(0, 30);
    }

    private applyCustomFeedHandle(handle: string, excluded = false): void {
        const normalized = handle.replace(/^@/, '').replace(/^!/, '').trim().toLowerCase();
        if (!normalized) {
            return;
        }

        const normalizedRule = excluded ? `!${normalized}` : normalized;

        const tokens = this.customFeedDraftHandles.split(/[,\n]+/).map(token => token.trim());
        const hasTokens = tokens.some(token => !!token);

        if (!hasTokens) {
            tokens.length = 0;
            tokens.push(normalizedRule);
        } else {
            const lastTokenIndex = tokens.length - 1;
            tokens[lastTokenIndex] = normalizedRule;
        }

        const orderedUniqueHandles: string[] = [];
        const seen = new Set<string>();
        for (const token of tokens) {
            const isExcluded = token.trim().startsWith('!');
            const normalizedToken = token.replace(/^!/, '').replace(/^@+/, '').trim().toLowerCase();
            if (!normalizedToken) {
                continue;
            }

            const dedupeKey = isExcluded ? `!${normalizedToken}` : normalizedToken;
            if (seen.has(dedupeKey)) {
                continue;
            }

            seen.add(dedupeKey);
            orderedUniqueHandles.push(dedupeKey);
            if (orderedUniqueHandles.length >= 20) {
                break;
            }
        }

        this.customFeedDraftHandles = orderedUniqueHandles
            .map(value => value.startsWith('!') ? `!@${value.slice(1)}` : `@${value}`)
            .join(', ');
        this.closeCustomFeedHandleSuggestions();
    }

    private extractCustomFeedHashtagQuery(value: string): string {
        const parts = value
            .split(/[\n,]+/)
            .map(part => part.trim())
            .filter(Boolean);
        const lastPart = parts.length > 0 ? parts[parts.length - 1] : '';
        return lastPart
            .replace(/^#/, '')
            .trim()
            .toLowerCase()
            .slice(0, 50);
    }

    private applyCustomFeedHashtag(tag: string): void {
        const normalized = tag.replace(/^#/, '').trim().toLowerCase();
        if (!normalized) {
            return;
        }

        const tokens = this.customFeedDraftHashtags.split(/[\n,]+/).map(token => token.trim());
        const hasTokens = tokens.some(token => !!token);

        if (!hasTokens) {
            tokens.length = 0;
            tokens.push(normalized);
        } else {
            const lastTokenIndex = tokens.length - 1;
            tokens[lastTokenIndex] = normalized;
        }

        const orderedUniqueTags: string[] = [];
        const seen = new Set<string>();
        for (const token of tokens) {
            const normalizedToken = token.replace(/^#+/, '').trim().toLowerCase();
            if (!normalizedToken || seen.has(normalizedToken)) {
                continue;
            }

            seen.add(normalizedToken);
            orderedUniqueTags.push(normalizedToken);
            if (orderedUniqueTags.length >= 20) {
                break;
            }
        }

        this.customFeedDraftHashtags = orderedUniqueTags.map(value => `#${value}`).join(', ');
        this.closeCustomFeedHashtagSuggestions();
    }

    private parseCustomFeedRules(value: string, prefix: '@' | '#'): string[] {
        const normalized = value
            .split(/[\s,\n]+/)
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => prefix === '@'
                ? part.replace(/^@+/, '').trim().toLowerCase()
                : part.replace(/^#+/, '').trim().toLowerCase())
            .filter(Boolean);

        return Array.from(new Set(normalized)).slice(0, 20);
    }

    private parseCustomFeedHandleRules(value: string): string[] {
        const normalized = value
            .split(/[\s,\n]+/)
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const isExcluded = part.startsWith('!');
                const withoutExclude = isExcluded ? part.slice(1) : part;
                const normalizedHandle = withoutExclude.replace(/^@+/, '').trim().toLowerCase();
                if (!normalizedHandle) {
                    return '';
                }

                return isExcluded ? `!${normalizedHandle}` : normalizedHandle;
            })
            .filter(Boolean);

        return Array.from(new Set(normalized)).slice(0, 20);
    }

    private isCustomFeedHandleExclusionToken(value: string): boolean {
        const parts = value
            .split(/[,\n]+/)
            .map(part => part.trim())
            .filter(Boolean);
        if (parts.length === 0) {
            return false;
        }

        return parts[parts.length - 1].startsWith('!');
    }

    private async markActiveStoryViewed(): Promise<void> {
        const story = this.activeStory;
        if (!story || story.viewedByMe || this.markingStoryId) {
            return;
        }

        this.markingStoryId = story.id;
        this.persistActiveStoryResume();
        try {
            await this.session.markStoryViewedAsync(story.id);
            this.markStoryViewedLocally(story.id);
        } catch {
            return;
        } finally {
            this.markingStoryId = null;
        }
    }

    private markStoryViewedLocally(storyId: string): void {
        this.storyGroups = this.storyGroups.map(group => {
            const updatedStories = group.stories.map(story => story.id === storyId ? { ...story, viewedByMe: true } : story);
            return {
                ...group,
                stories: updatedStories,
                hasUnseenStories: updatedStories.some(story => !story.viewedByMe)
            };
        });

        if (this.activeStoryGroup) {
            this.activeStoryGroup = this.storyGroups.find(group => group.authorId === this.activeStoryGroup?.authorId) ?? this.activeStoryGroup;
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

    private persistActiveStoryResume(): void {
        const group = this.activeStoryGroup;
        const story = this.activeStory;
        if (!group || !story) {
            return;
        }

        if (this.session.isAuthenticated()) {
            void this.session.upsertStoryPlaybackProgressAsync(group.authorId, story.id, 0);
        }
    }

    private tryOpenPendingStoryHandle(): void {
        const pendingHandle = this.pendingStoryHandleFromRoute;
        if (!pendingHandle || !this.storyGroups.length) {
            return;
        }

        const group = this.storyGroups.find(item => item.authorHandle.trim().toLowerCase() === pendingHandle);
        if (!group) {
            return;
        }

        this.pendingStoryHandleFromRoute = null;
        this.openStoryGroup(group);
    }

    private async runPostMutation(postId: string, work: () => Promise<PostDto>, failureMessage: string): Promise<void> {
        if (this.reactingPostId === postId) {
            return;
        }

        this.reactingPostId = postId;
        try {
            const updated = await work();
            this.applyPostUpdate(updated);
            this.recordEngagementActivity();
        } catch {
            this.error = failureMessage;
        } finally {
            this.reactingPostId = null;
        }
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
            const minStart = Math.max(0, this.storyTrimEndSeconds - FeedPageComponent.StoryMaxTrimDurationSeconds);
            const nextStart = Math.max(minStart, Math.min(this.storyTrimDragOriginStartSeconds + roundedDelta, this.storyTrimEndSeconds - 1));
            this.storyTrimStartSeconds = nextStart;
            this.syncStoryPreviewToTrimRange();
            return;
        }

        if (this.draggingStoryTrimPart === 'end') {
            const maxEnd = Math.min(this.storyMediaDurationSeconds, this.storyTrimStartSeconds + FeedPageComponent.StoryMaxTrimDurationSeconds);
            const nextEnd = Math.max(this.storyTrimStartSeconds + 1, Math.min(this.storyTrimDragOriginEndSeconds + roundedDelta, maxEnd));
            this.storyTrimEndSeconds = nextEnd;
            this.syncStoryPreviewToTrimRange();
            return;
        }

        const span = Math.max(1, Math.min(FeedPageComponent.StoryMaxTrimDurationSeconds, this.storyTrimDragOriginEndSeconds - this.storyTrimDragOriginStartSeconds));
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
        const limit = FeedPageComponent.StoryFrameOffsetLimit;
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
                    const outputHeight = Math.max(1, Math.round(outputWidth / FeedPageComponent.StoryOutputAspect));

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
        const targetAspect = FeedPageComponent.StoryOutputAspect;
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
        const frameScale = Math.max(0.4, Math.min(1, FeedPageComponent.StoryCropFrameHeightPercent / 100));
        const cropWidth = Math.max(1, Math.round(maxAspectCrop.width * frameScale));
        const cropHeight = Math.max(1, Math.round(maxAspectCrop.height * frameScale));

        const availableShiftX = Math.max(0, (width - cropWidth) / 2);
        const availableShiftY = Math.max(0, (height - cropHeight) / 2);
        const normalizedX = this.storyFrameOffsetX / FeedPageComponent.StoryFrameOffsetLimit;
        const normalizedY = this.storyFrameOffsetY / FeedPageComponent.StoryFrameOffsetLimit;

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
}