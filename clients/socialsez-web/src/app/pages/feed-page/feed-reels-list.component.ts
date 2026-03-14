import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, QueryList, SimpleChanges, ViewChildren, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReelCommentDto, ReelDto } from '../../core/api.types';
import { parseUtcDate, resolveAppLocale } from '../../core/date-time.util';
import { buildUnfurlShareUrl } from '../../core/unfurl-link.util';
import { CommentsSheetComponent } from '../../shared/comments-sheet/comments-sheet.component';

export interface ReelCommentCreateEvent {
    reel: ReelDto;
    content: string;
    parentCommentId?: string | null;
}

export interface ReelCommentUpdateEvent {
    reel: ReelDto;
    commentId: string;
    content: string;
}

export interface ReelCommentDeleteEvent {
    reel: ReelDto;
    comment: ReelCommentDto;
}

export interface ReelCommentReportEvent {
    reel: ReelDto;
    comment: ReelCommentDto;
}

@Component({
    selector: 'app-feed-reels-list',
    standalone: true,
    imports: [CommonModule, RouterLink, CommentsSheetComponent],
    templateUrl: './feed-reels-list.component.html',
    styleUrl: './feed-reels-list.component.scss'
})
export class FeedReelsListComponent implements AfterViewInit, OnChanges, OnDestroy {
    @Input() reels: ReelDto[] = [];
    @Input() activeStoryAuthorHandles: string[] = [];
    @Input() unseenStoryAuthorHandles: string[] = [];
    @Input() reactingReelId: string | null = null;
    @Input() commentingReelId: string | null = null;
    @Input() sharingReelId: string | null = null;
    @Input() savedReelIds: string[] = [];
    @Input() viewerProfileId: string | null = null;
    @Input() canInteract = true;
    @Input() showOwnerActions = false;
    @Input() updatingReelId: string | null = null;
    @Input() deletingReelId: string | null = null;
    @Input() hideSensitiveMedia = false;
    @ViewChildren('reelItem', { read: ElementRef }) private readonly reelItemRefs!: QueryList<ElementRef<HTMLElement>>;
    @ViewChildren('reelVideoEl', { read: ElementRef }) private readonly reelVideoRefs!: QueryList<ElementRef<HTMLVideoElement>>;

    @Output() likeToggled = new EventEmitter<ReelDto>();
    @Output() reelCommentLikeToggled = new EventEmitter<{ reel: ReelDto; commentId: string }>();
    @Output() commentAdded = new EventEmitter<ReelCommentCreateEvent>();
    @Output() reelCommentUpdated = new EventEmitter<ReelCommentUpdateEvent>();
    @Output() reelCommentDeleteRequested = new EventEmitter<ReelCommentDeleteEvent>();
    @Output() reelCommentReportRequested = new EventEmitter<ReelCommentReportEvent>();
    @Output() shareRequested = new EventEmitter<ReelDto>();
    @Output() saveToggled = new EventEmitter<ReelDto>();
    @Output() reportRequested = new EventEmitter<ReelDto>();
    @Output() reelUpdated = new EventEmitter<{ reel: ReelDto; caption: string }>();
    @Output() reelDeleted = new EventEmitter<ReelDto>();
    @Output() authorAvatarClicked = new EventEmitter<string>();

    activeReelId: string | null = null;
    editingReelId: string | null = null;
    editingReelCaption = '';
    editingReelCommentId: string | null = null;
    editingReelCommentDraft = '';
    copiedReelLinkId: string | null = null;
    reelSettingsMenuReelId: string | null = null;
    private intersectionObserver: IntersectionObserver | null = null;
    private readonly reelVisibility = new Map<string, number>();
    private readonly mutedReelIds = new Set<string>();
    private readonly revealedSensitiveReelIds = new Set<string>();
    private readonly pausedByUserReelIds = new Set<string>();
    private readonly failedReelVideoIds = new Set<string>();
    private readonly reelPlaybackRetryCountById = new Map<string, number>();
    private readonly expandedReelCaptions = new Set<string>();
    private readonly expandedReelReplyThreadRootsByReelId = new Map<string, Set<string>>();
    private readonly openedReelComments = new Set<string>();
    private readonly reelCommentDraftById = new Map<string, string>();
    private readonly replyingToReelCommentByReelId = new Map<string, string | null>();
    private readonly reelMetadataCache = new Map<string, { source: string; location: string; collaborators: string[]; caption: string; frameZoom: number; frameOffsetX: number; frameOffsetY: number }>();
    private readonly pointerHandledActionKeys = new Map<string, number>();
    private copyLinkResetTimerId: number | null = null;
    private readonly ngZone = inject(NgZone);
    private readonly preciseDateFormatter = new Intl.DateTimeFormat(resolveAppLocale(), {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    ngAfterViewInit(): void {
        this.setupVisibilityObserver();
        this.reelItemRefs.changes.subscribe(() => {
            this.setupVisibilityObserver();
        });
        this.reelVideoRefs.changes.subscribe(() => {
            this.syncPlaybackState();
        });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['updatingReelId']?.previousValue && !changes['updatingReelId']?.currentValue && this.editingReelId === changes['updatingReelId'].previousValue) {
            this.cancelReelEdit();
        }

        if (!changes['reels']) {
            return;
        }

        const currentIds = new Set(this.reels.map(reel => reel.id));
        for (const key of Array.from(this.reelVisibility.keys())) {
            if (!currentIds.has(key)) {
                this.reelVisibility.delete(key);
            }
        }

        for (const key of Array.from(this.mutedReelIds.values())) {
            if (!currentIds.has(key)) {
                this.mutedReelIds.delete(key);
            }
        }

        for (const key of Array.from(this.pausedByUserReelIds.values())) {
            if (!currentIds.has(key)) {
                this.pausedByUserReelIds.delete(key);
            }
        }

        for (const key of Array.from(this.failedReelVideoIds.values())) {
            if (!currentIds.has(key)) {
                this.failedReelVideoIds.delete(key);
            }
        }

        for (const key of Array.from(this.reelPlaybackRetryCountById.keys())) {
            if (!currentIds.has(key)) {
                this.reelPlaybackRetryCountById.delete(key);
            }
        }

        for (const key of Array.from(this.revealedSensitiveReelIds.values())) {
            if (!currentIds.has(key)) {
                this.revealedSensitiveReelIds.delete(key);
            }
        }

        for (const key of Array.from(this.expandedReelReplyThreadRootsByReelId.keys())) {
            if (!currentIds.has(key)) {
                this.expandedReelReplyThreadRootsByReelId.delete(key);
            }
        }

        if (this.reelSettingsMenuReelId && !currentIds.has(this.reelSettingsMenuReelId)) {
            this.reelSettingsMenuReelId = null;
        }

        window.setTimeout(() => {
            this.selectMostVisibleReel();
            this.syncPlaybackState();
        }, 0);
    }

    ngOnDestroy(): void {
        this.intersectionObserver?.disconnect();
        for (const videoRef of this.reelVideoRefs?.toArray() ?? []) {
            const video = videoRef.nativeElement;
            video.pause();
        }

        if (this.copyLinkResetTimerId !== null) {
            window.clearTimeout(this.copyLinkResetTimerId);
            this.copyLinkResetTimerId = null;
        }
    }

    onToggleLike(reel: ReelDto): void {
        if (!this.canInteract) {
            return;
        }

        this.likeToggled.emit(reel);
    }

    onShareReel(reel: ReelDto): void {
        if (!this.canInteract) {
            return;
        }

        this.shareRequested.emit(reel);
    }

    onToggleSaved(reel: ReelDto): void {
        if (!this.canInteract) {
            return;
        }

        this.saveToggled.emit(reel);
    }

    isReelSaved(reelId: string): boolean {
        return this.savedReelIds.includes(reelId);
    }

    onReportReel(reel: ReelDto): void {
        if (!this.canReportReel(reel)) {
            return;
        }

        this.reportRequested.emit(reel);
    }

    canReportReel(reel: ReelDto): boolean {
        return this.canInteract && !this.canManageReel(reel);
    }

    toggleReelSettingsMenu(reel: ReelDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        this.reelSettingsMenuReelId = this.reelSettingsMenuReelId === reel.id ? null : reel.id;
    }

    isReelSettingsMenuOpen(reel: ReelDto): boolean {
        return this.reelSettingsMenuReelId === reel.id;
    }

    closeReelSettingsMenu(): void {
        this.reelSettingsMenuReelId = null;
    }

    reportReelFromMenu(reel: ReelDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.onReportReel(reel);
        this.closeReelSettingsMenu();
    }

    async onCopyReelLink(reel: ReelDto): Promise<void> {
        const link = buildUnfurlShareUrl(`/reel/${reel.id}`);
        try {
            await navigator.clipboard.writeText(link);
            this.ngZone.run(() => {
                this.copiedReelLinkId = reel.id;
                if (this.copyLinkResetTimerId !== null) {
                    window.clearTimeout(this.copyLinkResetTimerId);
                }
                this.copyLinkResetTimerId = window.setTimeout(() => {
                    this.ngZone.run(() => {
                        this.copiedReelLinkId = null;
                        this.copyLinkResetTimerId = null;
                    });
                }, 2000);
            });
        } catch {
            return;
        }
    }

    startReelEdit(reel: ReelDto): void {
        if (!this.canShowOwnerActions(reel) || this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.editingReelId = reel.id;
        this.editingReelCaption = this.getReelCaptionText(reel);
    }

    cancelReelEdit(): void {
        if (this.updatingReelId) {
            return;
        }

        this.editingReelId = null;
        this.editingReelCaption = '';
    }

    submitReelEdit(reel: ReelDto): void {
        if (!this.canShowOwnerActions(reel) || this.updatingReelId || this.deletingReelId || this.editingReelId !== reel.id) {
            return;
        }

        const caption = this.buildCaptionWithMetadata(reel, this.editingReelCaption);
        this.reelUpdated.emit({ reel, caption });
    }

    requestReelDelete(reel: ReelDto): void {
        if (!this.canShowOwnerActions(reel) || this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.reelDeleted.emit(reel);
    }

    onAuthorAvatarClick(handle: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.authorAvatarClicked.emit(handle);
    }

    shouldHideSensitiveReel(reel: ReelDto): boolean {
        return this.hideSensitiveMedia && reel.isSensitive === true && !this.revealedSensitiveReelIds.has(reel.id);
    }

    revealSensitiveReel(reel: ReelDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.revealedSensitiveReelIds.add(reel.id);
    }

    hasActiveStoryForAuthor(handle: string): boolean {
        const normalized = handle.trim().toLowerCase();
        return this.activeStoryAuthorHandles.some(item => item.trim().toLowerCase() === normalized);
    }

    hasUnseenStoryForAuthor(handle: string): boolean {
        const normalized = handle.trim().toLowerCase();
        return this.unseenStoryAuthorHandles.some(item => item.trim().toLowerCase() === normalized);
    }

    trackReelById(_: number, reel: ReelDto): string {
        return reel.id;
    }

    canManageReel(reel: ReelDto): boolean {
        return !!this.viewerProfileId && reel.authorId === this.viewerProfileId;
    }

    canShowOwnerActions(reel: ReelDto): boolean {
        return this.showOwnerActions && this.canManageReel(reel);
    }

    isEditingReel(reelId: string): boolean {
        return this.editingReelId === reelId;
    }

    onCommentClick(reelId: string): void {
        if (this.openedReelComments.has(reelId)) {
            this.openedReelComments.delete(reelId);
            this.replyingToReelCommentByReelId.delete(reelId);
            this.expandedReelReplyThreadRootsByReelId.delete(reelId);
            return;
        }

        this.openedReelComments.add(reelId);
        const input = document.querySelector<HTMLTextAreaElement>(`textarea[data-reel-comment-id="${reelId}"]`);
        window.setTimeout(() => {
            input?.focus();
        }, 0);
    }

    isCommentsOpen(reelId: string): boolean {
        return this.openedReelComments.has(reelId);
    }

    getReelCommentDraft(reelId: string): string {
        return this.reelCommentDraftById.get(reelId) ?? '';
    }

    onReelCommentDraftChange(reelId: string, value: string): void {
        this.reelCommentDraftById.set(reelId, value);
    }

    async replyToReelComment(reelId: string, comment: ReelCommentDto, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        if (!this.canInteract) {
            return;
        }

        const mentionPrefix = `@${comment.authorHandle} `;
        const existing = this.getReelCommentDraft(reelId);
        const trimmed = existing.trim();
        const next = trimmed.startsWith(mentionPrefix.trim())
            ? existing
            : `${mentionPrefix}${trimmed}`.trimEnd();

        this.replyingToReelCommentByReelId.set(reelId, comment.id);
        this.reelCommentDraftById.set(reelId, next);
        this.openedReelComments.add(reelId);
        const reel = this.reels.find(item => item.id === reelId);
        const rootId = reel ? (this.findReelCommentRootId(reel, comment.id) ?? comment.id) : comment.id;
        this.expandReelReplyThread(reelId, rootId);

        await Promise.resolve();
        const input = document.querySelector<HTMLTextAreaElement>(`textarea[data-reel-comment-id="${reelId}"]`);
        if (!input) {
            return;
        }

        input.focus();
        input.setSelectionRange(next.length, next.length);
    }

    onSubmitReelComment(reel: ReelDto): void {
        if (!this.canInteract) {
            return;
        }

        const draft = this.getReelCommentDraft(reel.id).trim();
        if (!draft || this.commentingReelId === reel.id) {
            return;
        }

        const parentCommentId = this.replyingToReelCommentByReelId.get(reel.id) ?? null;
        this.commentAdded.emit({ reel, content: draft, parentCommentId });
        this.reelCommentDraftById.set(reel.id, '');
        this.replyingToReelCommentByReelId.delete(reel.id);
    }

    toggleReelCommentLike(reel: ReelDto, comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        if (!this.canInteract) {
            return;
        }

        this.reelCommentLikeToggled.emit({ reel, commentId: comment.id });
    }

    onReelCommentLikeMouseDown(reel: ReelDto, comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`reel-comment-like:${reel.id}:${comment.id}`);
        this.toggleReelCommentLike(reel, comment, event);
    }

    onReelCommentLikeClick(reel: ReelDto, comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`reel-comment-like:${reel.id}:${comment.id}`)) {
            return;
        }

        this.toggleReelCommentLike(reel, comment, event);
    }

    canEditReelComment(comment: ReelCommentDto): boolean {
        return !!this.viewerProfileId && comment.authorId === this.viewerProfileId;
    }

    canDeleteReelComment(reel: ReelDto, comment: ReelCommentDto): boolean {
        if (!this.viewerProfileId) {
            return false;
        }

        return comment.authorId === this.viewerProfileId || reel.authorId === this.viewerProfileId;
    }

    canReportReelComment(comment: ReelCommentDto): boolean {
        if (!this.viewerProfileId || !this.canInteract) {
            return false;
        }

        return comment.authorId !== this.viewerProfileId;
    }

    startReelCommentEdit(comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        if (!this.canEditReelComment(comment)) {
            return;
        }

        this.editingReelCommentId = comment.id;
        this.editingReelCommentDraft = comment.content;
    }

    onReelCommentEditMouseDown(comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`reel-comment-edit:${comment.id}`);
        window.setTimeout(() => {
            this.startReelCommentEdit(comment, event);
        }, 0);
    }

    onReelCommentEditClick(comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`reel-comment-edit:${comment.id}`)) {
            return;
        }

        this.startReelCommentEdit(comment, event);
    }

    cancelReelCommentEdit(event?: MouseEvent): void {
        event?.preventDefault();
        event?.stopPropagation();
        this.editingReelCommentId = null;
        this.editingReelCommentDraft = '';
    }

    saveReelCommentEdit(reel: ReelDto, comment: ReelCommentDto, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        if (!this.canEditReelComment(comment)) {
            return;
        }

        const updated = this.editingReelCommentDraft.trim();
        if (!updated) {
            return;
        }

        this.reelCommentUpdated.emit({ reel, commentId: comment.id, content: updated });
        this.cancelReelCommentEdit();
    }

    requestDeleteReelComment(reel: ReelDto, comment: ReelCommentDto, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        this.reelCommentDeleteRequested.emit({ reel, comment });
        if (this.editingReelCommentId === comment.id) {
            this.cancelReelCommentEdit();
        }
    }

    requestReportReelComment(reel: ReelDto, comment: ReelCommentDto, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        if (!this.canReportReelComment(comment)) {
            return;
        }

        this.reelCommentReportRequested.emit({ reel, comment });
    }

    onDeleteReelCommentMouseDown(reel: ReelDto, comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`reel-comment-delete:${reel.id}:${comment.id}`);
        this.requestDeleteReelComment(reel, comment, event);
    }

    onDeleteReelCommentClick(reel: ReelDto, comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`reel-comment-delete:${reel.id}:${comment.id}`)) {
            return;
        }

        this.requestDeleteReelComment(reel, comment, event);
    }

    onReelCommentReplyMouseDown(reelId: string, comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`reel-comment-reply:${reelId}:${comment.id}`);
        void this.replyToReelComment(reelId, comment, event);
    }

    onReelCommentReplyClick(reelId: string, comment: ReelCommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`reel-comment-reply:${reelId}:${comment.id}`)) {
            return;
        }

        void this.replyToReelComment(reelId, comment, event);
    }

    getOrderedReelComments(reel: ReelDto): Array<{ comment: ReelCommentDto; depth: number }> {
        const comments = reel.comments ?? [];
        if (!comments.length) {
            return [];
        }

        const byParent = new Map<string, ReelCommentDto[]>();
        const byId = new Set(comments.map(comment => comment.id));
        const roots: ReelCommentDto[] = [];

        for (const comment of comments) {
            const parentId = comment.parentCommentId?.trim();
            if (!parentId || !byId.has(parentId)) {
                roots.push(comment);
                continue;
            }

            const bucket = byParent.get(parentId);
            if (bucket) {
                bucket.push(comment);
            } else {
                byParent.set(parentId, [comment]);
            }
        }

        const sortByCreated = (items: ReelCommentDto[]) => items.sort((a, b) => {
            const left = Date.parse(a.createdAtUtc);
            const right = Date.parse(b.createdAtUtc);
            if (Number.isNaN(left) || Number.isNaN(right)) {
                return a.createdAtUtc.localeCompare(b.createdAtUtc);
            }

            return left - right;
        });

        sortByCreated(roots);
        for (const bucket of byParent.values()) {
            sortByCreated(bucket);
        }

        const ordered: Array<{ comment: ReelCommentDto; depth: number }> = [];
        const stack = roots.map(root => ({ comment: root, depth: 0, rootId: root.id })).reverse();
        const expandedRoots = this.expandedReelReplyThreadRootsByReelId.get(reel.id) ?? new Set<string>();

        while (stack.length) {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            if (current.depth > 0 && !expandedRoots.has(current.rootId)) {
                continue;
            }

            ordered.push(current);
            const children = byParent.get(current.comment.id) ?? [];
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push({ comment: children[index], depth: current.depth + 1, rootId: current.rootId });
            }
        }

        return ordered;
    }

    getReelReplyCount(reel: ReelDto, rootCommentId: string): number {
        const comments = reel.comments ?? [];
        if (!comments.length) {
            return 0;
        }

        const byParent = new Map<string, ReelCommentDto[]>();
        for (const comment of comments) {
            const parentId = comment.parentCommentId?.trim();
            if (!parentId) {
                continue;
            }

            const bucket = byParent.get(parentId);
            if (bucket) {
                bucket.push(comment);
            } else {
                byParent.set(parentId, [comment]);
            }
        }

        let total = 0;
        const stack = [...(byParent.get(rootCommentId) ?? [])];
        while (stack.length) {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            total += 1;
            const children = byParent.get(current.id) ?? [];
            for (const child of children) {
                stack.push(child);
            }
        }

        return total;
    }

    isReelReplyThreadExpanded(reelId: string, rootCommentId: string): boolean {
        return this.expandedReelReplyThreadRootsByReelId.get(reelId)?.has(rootCommentId) ?? false;
    }

    toggleReelReplyThread(reel: ReelDto, rootCommentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const replyCount = this.getReelReplyCount(reel, rootCommentId);
        const expanded = this.expandedReelReplyThreadRootsByReelId.get(reel.id);
        if (!replyCount) {
            expanded?.delete(rootCommentId);
            return;
        }

        if (expanded?.has(rootCommentId)) {
            expanded.delete(rootCommentId);
            return;
        }

        this.expandReelReplyThread(reel.id, rootCommentId);
    }

    onReelThreadToggleMouseDown(reel: ReelDto, rootCommentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        const key = `reel-thread-toggle:${reel.id}:${rootCommentId}`;
        this.markPointerHandled(key);
        this.toggleReelReplyThread(reel, rootCommentId, event);
    }

    onReelThreadToggleClick(reel: ReelDto, rootCommentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        const key = `reel-thread-toggle:${reel.id}:${rootCommentId}`;
        if (this.consumePointerHandled(key)) {
            return;
        }

        this.toggleReelReplyThread(reel, rootCommentId, event);
    }

    onReelFrameClick(reelId: string): void {
        if (this.isReelVideoUnavailable(reelId)) {
            return;
        }

        const video = this.findVideoByReelId(reelId);
        if (!video) {
            return;
        }

        if (!video.paused) {
            video.pause();
            this.pausedByUserReelIds.add(reelId);
            return;
        }

        this.pausedByUserReelIds.delete(reelId);
        if (this.activeReelId !== reelId) {
            this.activeReelId = reelId;
            this.syncPlaybackState();
            return;
        }

        void this.playVideo(video);
    }

    toggleMute(event: MouseEvent, reelId: string): void {
        event.preventDefault();
        event.stopPropagation();
        const video = this.findVideoByReelId(reelId);
        if (!video) {
            return;
        }

        if (this.isReelMuted(reelId)) {
            this.mutedReelIds.delete(reelId);
            video.muted = false;
            return;
        }

        this.mutedReelIds.add(reelId);
        video.muted = true;
    }

    isReelMuted(reelId: string): boolean {
        return this.mutedReelIds.has(reelId);
    }

    isReelVideoUnavailable(reelId: string): boolean {
        return this.failedReelVideoIds.has(reelId);
    }

    getReelPreloadMode(index: number): 'auto' | 'metadata' {
        const firstReelId = this.reels[0]?.id ?? null;
        if (index === 0 || (this.activeReelId !== null && this.activeReelId === this.reels[index]?.id) || (firstReelId !== null && this.activeReelId === null && this.reels[index]?.id === firstReelId)) {
            return 'auto';
        }

        return 'metadata';
    }

    onReelVideoLoadedMetadata(reelId: string): void {
        this.failedReelVideoIds.delete(reelId);
        this.reelPlaybackRetryCountById.delete(reelId);
        const video = this.findVideoByReelId(reelId);
        if (!video) {
            return;
        }

        video.muted = this.isReelMuted(reelId);
        if (this.activeReelId === reelId && !this.pausedByUserReelIds.has(reelId)) {
            void this.playVideo(video);
        }
    }

    onReelVideoError(reelId: string): void {
        const retries = this.reelPlaybackRetryCountById.get(reelId) ?? 0;
        if (retries < 1) {
            this.reelPlaybackRetryCountById.set(reelId, retries + 1);

            const video = this.findVideoByReelId(reelId);
            if (video) {
                const currentUrl = (video.currentSrc || video.src || '').trim();
                if (currentUrl) {
                    video.src = this.appendCacheBustQuery(currentUrl);
                    video.load();

                    if (this.activeReelId === reelId && !this.pausedByUserReelIds.has(reelId)) {
                        void this.playVideo(video);
                    }
                }
            }

            return;
        }

        this.failedReelVideoIds.add(reelId);
        this.pausedByUserReelIds.add(reelId);

        if (this.activeReelId === reelId) {
            this.activeReelId = null;
        }

        const video = this.findVideoByReelId(reelId);
        video?.pause();
    }

    getReelLocation(reel: ReelDto): string {
        return this.parseReelMetadata(reel).location;
    }

    getReelCollaborators(reel: ReelDto): string[] {
        return this.parseReelMetadata(reel).collaborators;
    }

    getReelCaptionText(reel: ReelDto): string {
        return this.parseReelMetadata(reel).caption;
    }

    getReelFrameTransform(reel: ReelDto): string {
        const metadata = this.parseReelMetadata(reel);
        return `translate(${metadata.frameOffsetX}%, ${metadata.frameOffsetY}%) scale(${metadata.frameZoom})`;
    }

    isReelCaptionExpanded(reelId: string): boolean {
        return this.expandedReelCaptions.has(reelId);
    }

    toggleReelCaption(reelId: string): void {
        if (this.expandedReelCaptions.has(reelId)) {
            this.expandedReelCaptions.delete(reelId);
            return;
        }

        this.expandedReelCaptions.add(reelId);
    }

    shouldShowReelReadMore(reel: ReelDto): boolean {
        const caption = this.getReelCaptionText(reel);
        return caption.length > 110;
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

    private parseReelMetadata(reel: ReelDto): { location: string; collaborators: string[]; caption: string; frameZoom: number; frameOffsetX: number; frameOffsetY: number } {
        const source = reel.caption ?? '';
        const cached = this.reelMetadataCache.get(reel.id);
        if (cached && cached.source === source) {
            return {
                location: cached.location,
                collaborators: [...cached.collaborators],
                caption: cached.caption,
                frameZoom: cached.frameZoom,
                frameOffsetX: cached.frameOffsetX,
                frameOffsetY: cached.frameOffsetY
            };
        }

        let location = '';
        let collaborators: string[] = [];
        let frameZoom = 1;
        let frameOffsetX = 0;
        let frameOffsetY = 0;
        const captionLines: string[] = [];

        for (const line of source.split('\n').map(value => value.trim()).filter(value => !!value)) {
            if (line.startsWith('📍')) {
                location = line.replace(/^📍\s*/, '').trim();
                continue;
            }

            if (line.startsWith('🤝')) {
                collaborators = line
                    .replace(/^🤝\s*/, '')
                    .split(/\s+/)
                    .map(value => value.trim())
                    .filter(value => !!value);
                continue;
            }

            if (line.startsWith('🎞️FRAME')) {
                const zoomMatch = /\bz=([\d.]+)/i.exec(line);
                const xMatch = /\bx=([-\d.]+)/i.exec(line);
                const yMatch = /\by=([-\d.]+)/i.exec(line);

                const parsedZoom = Number(zoomMatch?.[1] ?? '1');
                const parsedX = Number(xMatch?.[1] ?? '0');
                const parsedY = Number(yMatch?.[1] ?? '0');

                frameZoom = Number.isFinite(parsedZoom) ? Math.max(1, Math.min(2.5, parsedZoom)) : 1;
                frameOffsetX = Number.isFinite(parsedX) ? parsedX : 0;
                frameOffsetY = Number.isFinite(parsedY) ? parsedY : 0;
                continue;
            }

            captionLines.push(line);
        }

        const parsed = {
            location,
            collaborators,
            caption: captionLines.join(' '),
            frameZoom,
            frameOffsetX,
            frameOffsetY
        };

        this.reelMetadataCache.set(reel.id, {
            source,
            location: parsed.location,
            collaborators: [...parsed.collaborators],
            caption: parsed.caption,
            frameZoom: parsed.frameZoom,
            frameOffsetX: parsed.frameOffsetX,
            frameOffsetY: parsed.frameOffsetY
        });

        return parsed;
    }

    private buildCaptionWithMetadata(reel: ReelDto, caption: string): string {
        const metadataLines = (reel.caption ?? '')
            .split('\n')
            .map(value => value.trim())
            .filter(value => value.startsWith('📍') || value.startsWith('🤝') || value.startsWith('🎞️FRAME'));

        const trimmedCaption = caption.trim();
        if (trimmedCaption) {
            metadataLines.push(trimmedCaption);
        }

        return metadataLines.join('\n').trim();
    }

    private setupVisibilityObserver(): void {
        this.intersectionObserver?.disconnect();

        this.intersectionObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const element = entry.target as HTMLElement;
                const reelId = element.dataset['reelId'];
                if (!reelId) {
                    continue;
                }

                this.reelVisibility.set(reelId, entry.intersectionRatio);
            }

            this.selectMostVisibleReel();
            this.syncPlaybackState();
        }, {
            threshold: [0, 0.25, 0.5, 0.65, 0.85, 1]
        });

        for (const ref of this.reelItemRefs.toArray()) {
            this.intersectionObserver.observe(ref.nativeElement);
        }
    }

    private selectMostVisibleReel(): void {
        if (!this.reels.length) {
            this.activeReelId = null;
            return;
        }

        if (this.reelVisibility.size === 0) {
            this.activeReelId = this.reels[0].id;
            for (const reel of this.reels) {
                if (!this.mutedReelIds.has(reel.id)) {
                    this.mutedReelIds.add(reel.id);
                }
            }
            return;
        }

        let selectedId: string | null = null;
        let highestRatio = 0;

        for (const reel of this.reels) {
            const ratio = this.reelVisibility.get(reel.id) ?? 0;
            if (ratio > highestRatio) {
                highestRatio = ratio;
                selectedId = reel.id;
            }

            if (!this.mutedReelIds.has(reel.id)) {
                this.mutedReelIds.add(reel.id);
            }
        }

        this.activeReelId = highestRatio > 0 ? selectedId : null;
    }

    private syncPlaybackState(): void {
        for (const videoRef of this.reelVideoRefs.toArray()) {
            const video = videoRef.nativeElement;
            const reelId = video.dataset['reelId'];
            if (!reelId) {
                continue;
            }

            const shouldPlay = this.activeReelId === reelId
                && !this.pausedByUserReelIds.has(reelId)
                && !this.failedReelVideoIds.has(reelId);
            if (shouldPlay) {
                void this.playVideo(video);
                continue;
            }

            video.pause();
        }
    }

    private findVideoByReelId(reelId: string): HTMLVideoElement | null {
        for (const ref of this.reelVideoRefs.toArray()) {
            const video = ref.nativeElement;
            if (video.dataset['reelId'] === reelId) {
                return video;
            }
        }

        return null;
    }

    private async playVideo(video: HTMLVideoElement): Promise<void> {
        const reelId = video.dataset['reelId'];
        if (!reelId) {
            return;
        }

        this.failedReelVideoIds.delete(reelId);
        video.muted = this.isReelMuted(reelId);

        try {
            await video.play();
        } catch {
            if (!video.muted) {
                this.mutedReelIds.add(reelId);
                video.muted = true;

                try {
                    await video.play();
                    this.failedReelVideoIds.delete(reelId);
                    return;
                } catch {
                    return;
                }
            }

            return;
        }

        this.failedReelVideoIds.delete(reelId);
    }

    private appendCacheBustQuery(url: string): string {
        try {
            const parsed = new URL(url, window.location.origin);
            parsed.searchParams.set('v', Date.now().toString());
            return parsed.toString();
        } catch {
            const separator = url.includes('?') ? '&' : '?';
            return `${url}${separator}v=${Date.now()}`;
        }
    }

    private markPointerHandled(key: string): void {
        this.pointerHandledActionKeys.set(key, Date.now() + 700);
    }

    private expandReelReplyThread(reelId: string, rootCommentId: string): void {
        const existing = this.expandedReelReplyThreadRootsByReelId.get(reelId);
        if (existing) {
            existing.add(rootCommentId);
            return;
        }

        this.expandedReelReplyThreadRootsByReelId.set(reelId, new Set([rootCommentId]));
    }

    private findReelCommentRootId(reel: ReelDto, commentId: string): string | null {
        const comments = reel.comments ?? [];
        if (!comments.length) {
            return null;
        }

        const byId = new Map(comments.map(comment => [comment.id, comment]));
        let current = byId.get(commentId) ?? null;
        while (current?.parentCommentId) {
            const parentId = current.parentCommentId.trim();
            const parent = byId.get(parentId);
            if (!parent) {
                break;
            }

            current = parent;
        }

        return current?.id ?? null;
    }

    private consumePointerHandled(key: string): boolean {
        const expiresAt = this.pointerHandledActionKeys.get(key);
        if (!expiresAt) {
            return false;
        }

        this.pointerHandledActionKeys.delete(key);
        return expiresAt > Date.now();
    }
}
