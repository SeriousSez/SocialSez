import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter, skip } from 'rxjs';
import { FeedMode, PostDto, ReelDto, StoryDto, StoryGroupDto } from '../../core/api.types';
import { parseUtcDate, resolveAppLocale } from '../../core/date-time.util';
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
import { FeedReelsListComponent, ReelCommentCreateEvent, ReelCommentDeleteEvent, ReelCommentUpdateEvent } from './feed-reels-list.component';
import { FeedStoryViewerComponent } from './feed-story-viewer.component';
import { ReelComposerModalComponent, ReelUploadStatusEvent } from '../../shared/reel-composer-modal/reel-composer-modal.component';
import { SessionService } from '../../core/session.service';
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

type FeedReportTarget =
    | { kind: 'post'; id: string; handle: string }
    | { kind: 'reel'; id: string; handle: string }
    | { kind: 'story'; id: string; handle: string }
    | { kind: 'comment'; id: string; handle: string }
    | { kind: 'reel-comment'; id: string; handle: string };

@Component({
    selector: 'app-feed-page',
    standalone: true,
    imports: [CommonModule, RouterLink, PostCardComponent, PostComposerComponent, ReelComposerModalComponent, FeedReelsListComponent, FeedStoryViewerComponent, SharePostModalComponent, SharePostMessageModalComponent, ShareReelMessageModalComponent, ConfirmModalComponent, SkeletonComponent, SegmentedTabsComponent, CreateContentMenuComponent, ReportModalComponent],
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
    private readonly likedStoryIds = new Set<string>();
    storiesLoading = true;
    storiesError = '';
    selectedFeedMode: FeedMode = 'for-you';
    selectedContentTab: 'posts' | 'reels' = 'posts';
    readonly contentTabs: readonly SegmentedTabItem[] = [
        { id: 'posts', label: 'Posts' },
        { id: 'reels', label: 'Reels' }
    ];
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
    storyComposerError = '';
    storyViewerError = '';
    deletingStory = false;
    pendingDeleteStoryId: string | null = null;
    sendingStoryReply = false;
    sharingStoryMessage = false;
    showReelComposer = false;
    createMenuOpen = false;
    compactFeedEnabled = false;
    reelUploadStatus: ReelUploadStatusEvent | null = null;
    private reelUploadStatusHideTimeoutId: number | null = null;
    private composerCloseTimerId: number | null = null;
    private storyComposerCloseTimerId: number | null = null;
    private readonly preciseDateFormatter = new Intl.DateTimeFormat(resolveAppLocale(), {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    private readonly prefsStorageKey = 'socialsez-web-prefs';
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
    private pendingStoryHandleFromRoute: string | null = null;
    private hasLoadedAtLeastOnce = false;
    private repostCountSource: PostDto[] | null = null;
    private repostCountsByPostId = new Map<string, number>();

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
            .subscribe(() => {
                void this.load();
            });

        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                const handle = (params.get('story') ?? '').trim().toLowerCase();
                this.pendingStoryHandleFromRoute = handle || null;
                this.tryOpenPendingStoryHandle();
            });

        this.syncCompactFeedPreference();

        queueMicrotask(() => {
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
        this.storyComposerStep = 1;
        this.storyComposerError = '';
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

    async publishStory(): Promise<void> {
        if (!this.storyMediaFile || this.postingStory) {
            return;
        }

        this.postingStory = true;
        this.storyComposerError = '';
        const handle = this.uploadProgress.begin('Uploading story...', 'story');

        this.showStoryComposer = false;
        this.storyComposerClosing = false;
        this.detachStoryFrameDragListeners();
        this.detachStoryTrimDragListeners();

        void (async () => {
            try {
                const uploadStoryMedia = await this.buildProcessedStoryMedia(this.storyMediaFile!);
                const isSensitive = this.markStorySensitive;
                await this.session.createStoryAsync(uploadStoryMedia, undefined, isSensitive);
                await this.load();
                handle.succeed('Story published!');
            } catch {
                this.error = 'Could not publish story right now.';
                handle.fail('Story upload failed');
            } finally {
                this.postingStory = false;
                this.storyComposerStep = 1;
                this.storyComposerError = '';
                this.clearStoryMediaSelection();
            }
        })();
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
                const [postsResult, reelsResult] = await Promise.allSettled([
                    this.session.loadFeedAsync(mode),
                    this.session.loadReelFeedAsync(20, mode)
                ]);

                this.ngZone.run(() => {
                    if (postsResult.status === 'fulfilled') {
                        this.feed = postsResult.value;
                    } else {
                        this.feed = [];
                        this.error = 'Could not load your feed right now. Please try again.';
                    }

                    if (reelsResult.status === 'fulfilled') {
                        this.reels = reelsResult.value;
                    } else {
                        this.reels = [];
                        this.reelsError = 'Could not load reels right now. Please try again.';
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

                await this.loadStories(mode);
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

    selectContentTab(tab: 'posts' | 'reels'): void {
        this.selectedContentTab = tab;
    }

    onContentTabChanged(tabId: string): void {
        if (tabId !== 'posts' && tabId !== 'reels') {
            return;
        }

        this.selectContentTab(tabId);
    }

    openStoryGroup(group: StoryGroupDto): void {
        if (!group.stories.length) {
            return;
        }

        this.activeStoryGroup = group;
        this.activeStoryIndex = this.getNewestUnseenStoryIndex(group.stories);
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
                await this.session.savePostAsync(post.id);
                this.session.message = 'Post saved.';
            }
        } catch {
            this.session.message = 'Could not update saved status right now.';
        }
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
                await this.session.saveReelAsync(reel.id);
                this.session.message = 'Reel saved.';
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
        const createdAt = parseUtcDate(utcValue);
        if (Number.isNaN(createdAt.getTime())) {
            return utcValue;
        }

        const now = Date.now();
        const diffMs = Math.max(0, now - createdAt.getTime());
        const minuteMs = 60 * 1000;
        const hourMs = 60 * 60 * 1000;
        const dayMs = 24 * hourMs;
        const weekMs = 7 * dayMs;
        const monthMs = 30 * dayMs;

        if (diffMs < hourMs) {
            const minutes = Math.max(1, Math.floor(diffMs / minuteMs));
            return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
        }

        if (diffMs < dayMs) {
            const hours = Math.max(1, Math.floor(diffMs / hourMs));
            return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
        }

        if (diffMs < weekMs * 2) {
            const days = Math.max(1, Math.floor(diffMs / dayMs));
            return `${days} ${days === 1 ? 'day' : 'days'} ago`;
        }

        if (diffMs < monthMs) {
            const weeks = Math.max(1, Math.floor(diffMs / weekMs));
            return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
        }

        return this.preciseDateFormatter.format(createdAt);
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

    private async loadStories(mode: FeedMode): Promise<void> {
        this.ngZone.run(() => {
            this.storiesLoading = true;
            this.storiesError = '';
        });

        try {
            const loadedStoryGroups = await this.session.loadStoryFeedAsync(25, mode);

            this.ngZone.run(() => {
                this.storyGroups = loadedStoryGroups;
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

    private async markActiveStoryViewed(): Promise<void> {
        const story = this.activeStory;
        if (!story || story.viewedByMe || this.markingStoryId) {
            return;
        }

        this.markingStoryId = story.id;
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
        return new Promise<StoryTrimPreviewOption>((resolve, reject) => {
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
                    resolve({ previewUrl: URL.createObjectURL(blob) });
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