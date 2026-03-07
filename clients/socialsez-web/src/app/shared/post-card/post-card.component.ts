import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommentDto, PostDto, PostReactionDetailDto, ProfileDto } from '../../core/api.types';
import { SharedPostPreview, extractSharedPostFromContent } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';
import { CommentsSheetComponent } from '../comments-sheet/comments-sheet.component';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal.component';
import { LazyImageComponent } from '../lazy-image/lazy-image.component';
import { ReactionPickerComponent } from '../reaction-picker/reaction-picker.component';

export interface CommentUpdatePayload {
    commentId: string;
    content: string;
}

export interface CommentReactionPayload {
    commentId: string;
    reactionType: string;
}

export interface AddCommentPayload {
    content: string;
    parentCommentId?: string | null;
}

interface PostContentPart {
    text: string;
    hashtag?: string;
    mentionHandle?: string;
}

interface PostReactionBadge {
    type: string;
}

interface ReactionDetailEntry {
    profileId: string;
    displayName: string;
    handle: string;
    subtitle: string;
    imageUrl: string;
    reactionType: string;
}

@Component({
    selector: 'app-post-card',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactionPickerComponent, ConfirmModalComponent, CommentsSheetComponent, LazyImageComponent],
    templateUrl: './post-card.component.html',
    styleUrl: './post-card.component.scss'
})
export class PostCardComponent implements OnChanges, OnDestroy {
    private static readonly OpenCommentPostIds = new Set<string>();
    private static readonly ReactionsModalCloseDurationMs = 180;
    private static readonly ReactionsModalResizeDurationMs = 220;
    private static readonly MaxPostContentLength = 3000;
    private static readonly PostContentPreviewLength = 300;
    @Input({ required: true }) post!: PostDto;
    @Input()
    set content(value: string) {
        this._content = value ?? '';
        const parsed = extractSharedPostFromContent(this._content);
        this.sharedPost = parsed.sharedPost;
        this.fullContentText = parsed.text;
        this.contentExpanded = false;
        this.isContentTruncated = this.fullContentText.length > PostCardComponent.PostContentPreviewLength;
        this.refreshVisibleContent();
    }

    get content(): string {
        return this._content;
    }
    @Input() reacting = false;
    @Input() isEditing = false;
    @Input() editValue = '';
    @Input() showActions = false;
    @Input() showBottomMeta = false;
    @Input() showCommentsCount = false;
    @Input() savingEdit = false;
    @Input() deleting = false;
    @Input() viewerProfileId: string | null = null;
    @Input() busy = false;
    @Input() canInteract = true;
    @Input() repostCount = 0;

    @Output() editValueChange = new EventEmitter<string>();
    @Output() toggleLike = new EventEmitter<void>();
    @Output() setReaction = new EventEmitter<string>();
    @Output() clearReaction = new EventEmitter<void>();
    @Output() startEdit = new EventEmitter<void>();
    @Output() saveEdit = new EventEmitter<void>();
    @Output() cancelEdit = new EventEmitter<void>();
    @Output() deletePost = new EventEmitter<void>();
    @Output() addComment = new EventEmitter<AddCommentPayload>();
    @Output() updateComment = new EventEmitter<CommentUpdatePayload>();
    @Output() deleteComment = new EventEmitter<string>();
    @Output() reportComment = new EventEmitter<CommentDto>();
    @Output() setCommentReaction = new EventEmitter<CommentReactionPayload>();
    @Output() clearCommentReaction = new EventEmitter<string>();
    @Output() shareToFeed = new EventEmitter<void>();
    @Output() shareToChat = new EventEmitter<void>();
    @Output() copyLink = new EventEmitter<void>();
    @Output() reportPost = new EventEmitter<void>();

    readonly reactionOptions = [
        { type: 'Like', emoji: '👍' },
        { type: 'Love', emoji: '❤️' },
        { type: 'Laugh', emoji: '😂' },
        { type: 'Wow', emoji: '😮' },
        { type: 'Sad', emoji: '😢' },
        { type: 'Angry', emoji: '😡' },
        { type: 'PartyHorn', emoji: '🎉' },
        { type: 'Clap', emoji: '👏' }
    ] as const;

    commentInput = '';
    commentsOpen = false;
    reactionsModalOpen = false;
    reactionsModalClosing = false;
    reactionsModalAnimatingHeight = false;
    reactionsModalListHeight: number | null = null;
    selectedReactionFilter = 'all';
    replyingToCommentId: string | null = null;
    editingCommentId: string | null = null;
    editCommentContent = '';
    pendingDeleteCommentId: string | null = null;
    contentLines: PostContentPart[][] = [];
    fullContentText = '';
    isContentTruncated = false;
    contentExpanded = false;
    sharedPost: SharedPostPreview | null = null;
    mentionResults: ProfileDto[] = [];
    mentionOpen = false;
    mentionLoading = false;
    private _content = '';
    private readonly router = inject(Router);
    private readonly session = inject(SessionService);
    private readonly ngZone = inject(NgZone);
    private currentPostId: string | null = null;
    mentionTarget: 'post-edit' | 'comment-new' | 'comment-edit' | null = null;
    mentionTargetCommentId: string | null = null;
    copyLinkCopied = false;
    private readonly expandedCommentReplyRootIds = new Set<string>();
    private mentionRangeStart = -1;
    private mentionRangeEnd = -1;
    private mentionSearchDebounceId: number | null = null;
    private copyLinkResetTimerId: number | null = null;
    private reactionsModalCloseTimerId: number | null = null;
    private reactionsModalResizeTimerId: number | null = null;
    private mentionSearchToken = 0;
    private readonly pointerHandledActionKeys = new Map<string, number>();
    @ViewChild('reactionsModalList') private reactionsModalListRef?: ElementRef<HTMLDivElement>;

    ngOnDestroy(): void {
        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }

        if (this.copyLinkResetTimerId !== null) {
            window.clearTimeout(this.copyLinkResetTimerId);
            this.copyLinkResetTimerId = null;
        }

        if (this.reactionsModalCloseTimerId !== null) {
            window.clearTimeout(this.reactionsModalCloseTimerId);
            this.reactionsModalCloseTimerId = null;
        }

        if (this.reactionsModalResizeTimerId !== null) {
            window.clearTimeout(this.reactionsModalResizeTimerId);
            this.reactionsModalResizeTimerId = null;
        }

        if (this.currentPostId && !this.commentsOpen) {
            PostCardComponent.OpenCommentPostIds.delete(this.currentPostId);
        }

    }

    ngOnChanges(changes: SimpleChanges): void {
        if (!changes['post']) {
            return;
        }

        const nextPostId = this.post?.id ?? null;
        if (!nextPostId || nextPostId === this.currentPostId) {
            return;
        }

        this.currentPostId = nextPostId;
        this.commentsOpen = PostCardComponent.OpenCommentPostIds.has(nextPostId);
        this.replyingToCommentId = null;
        this.expandedCommentReplyRootIds.clear();

    }

    onPostPrimaryReaction(): void {
        if (!this.canInteract) {
            return;
        }

        if (this.post.myReactionType) {
            this.clearReaction.emit();
            return;
        }

        this.setReaction.emit('Love');
    }

    onPostReactionSelected(reactionType: string): void {
        if (!this.canInteract) {
            return;
        }

        if (this.post.myReactionType === reactionType) {
            this.clearReaction.emit();
            return;
        }

        this.setReaction.emit(reactionType);
    }

    onPostEditInput(value: string, textarea: HTMLTextAreaElement): void {
        const normalizedValue = this.normalizePostContentLength(value);
        this.editValueChange.emit(normalizedValue);

        if (normalizedValue !== value) {
            const nextCaret = Math.min(textarea.selectionStart ?? normalizedValue.length, normalizedValue.length);
            textarea.value = normalizedValue;
            textarea.setSelectionRange(nextCaret, nextCaret);
        }

        this.updateMentionSuggestions('post-edit', null, normalizedValue, textarea.selectionStart ?? normalizedValue.length);
    }

    toggleContentExpansion(): void {
        if (!this.isContentTruncated) {
            return;
        }

        this.contentExpanded = !this.contentExpanded;
        this.refreshVisibleContent();
    }

    onPostEditCursor(textarea: HTMLTextAreaElement): void {
        this.updateMentionSuggestions('post-edit', null, this.editValue, textarea.selectionStart ?? this.editValue.length);
    }

    submitComment(): void {
        if (!this.canInteract) {
            return;
        }

        const content = this.commentInput.trim();
        if (!content) {
            return;
        }

        this.addComment.emit({ content, parentCommentId: this.replyingToCommentId });
        this.commentInput = '';
        this.replyingToCommentId = null;
    }

    onCommentInput(value: string, textarea: HTMLTextAreaElement): void {
        this.commentInput = value;
        this.updateMentionSuggestions('comment-new', null, value, textarea.selectionStart ?? value.length);
    }

    onCommentCursor(textarea: HTMLTextAreaElement): void {
        this.updateMentionSuggestions('comment-new', null, this.commentInput, textarea.selectionStart ?? this.commentInput.length);
    }

    toggleComments(): void {
        this.commentsOpen = !this.commentsOpen;

        const postId = this.post?.id;
        if (!postId) {
            return;
        }

        if (this.commentsOpen) {
            PostCardComponent.OpenCommentPostIds.add(postId);
            return;
        }

        this.replyingToCommentId = null;
        this.expandedCommentReplyRootIds.clear();
        PostCardComponent.OpenCommentPostIds.delete(postId);
    }

    async replyToComment(comment: CommentDto): Promise<void> {
        if (!this.canInteract) {
            return;
        }

        this.commentsOpen = true;
        const postId = this.post?.id;
        if (postId) {
            PostCardComponent.OpenCommentPostIds.add(postId);
        }

        const mentionPrefix = `@${comment.authorHandle} `;
        const current = this.commentInput.trim();
        this.commentInput = current.startsWith(mentionPrefix.trim())
            ? this.commentInput
            : `${mentionPrefix}${current}`.trimEnd();
        this.replyingToCommentId = comment.id;
        const rootId = this.findCommentRootId(comment.id) ?? comment.id;
        this.expandedCommentReplyRootIds.add(rootId);

        await this.focusMatchingTextarea('.comment-compose textarea', this.commentInput.length);
    }

    canEditComment(comment: CommentDto): boolean {
        return !!this.viewerProfileId && comment.authorId === this.viewerProfileId;
    }

    get orderedComments(): Array<{ comment: CommentDto; depth: number }> {
        const comments = this.post?.comments ?? [];
        if (!comments.length) {
            return [];
        }

        const byParent = new Map<string, CommentDto[]>();
        const byId = new Set(comments.map(comment => comment.id));
        const roots: CommentDto[] = [];

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

        const sortByCreated = (items: CommentDto[]) => items.sort((a, b) => {
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

        const ordered: Array<{ comment: CommentDto; depth: number }> = [];
        const stack = roots.map(root => ({ comment: root, depth: 0, rootId: root.id })).reverse();

        while (stack.length) {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            if (current.depth > 0 && !this.expandedCommentReplyRootIds.has(current.rootId)) {
                continue;
            }

            ordered.push(current);
            const children = byParent.get(current.comment.id) ?? [];
            for (let index = children.length - 1; index >= 0; index--) {
                stack.push({ comment: children[index], depth: current.depth + 1, rootId: current.rootId });
            }
        }

        return ordered;
    }

    canDeleteComment(comment: CommentDto): boolean {
        if (!this.viewerProfileId) {
            return false;
        }

        return comment.authorId === this.viewerProfileId || this.post.authorId === this.viewerProfileId;
    }

    canReportComment(comment: CommentDto): boolean {
        if (!this.viewerProfileId || !this.canInteract) {
            return false;
        }

        return comment.authorId !== this.viewerProfileId;
    }

    getCommentReplyCount(rootCommentId: string): number {
        const comments = this.post?.comments ?? [];
        if (!comments.length) {
            return 0;
        }

        const byParent = new Map<string, CommentDto[]>();
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

    isCommentReplyThreadExpanded(rootCommentId: string): boolean {
        return this.expandedCommentReplyRootIds.has(rootCommentId);
    }

    toggleCommentReplyThread(rootCommentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const replyCount = this.getCommentReplyCount(rootCommentId);
        if (!replyCount) {
            this.expandedCommentReplyRootIds.delete(rootCommentId);
            return;
        }

        if (this.expandedCommentReplyRootIds.has(rootCommentId)) {
            this.expandedCommentReplyRootIds.delete(rootCommentId);
            return;
        }

        this.expandedCommentReplyRootIds.add(rootCommentId);
    }

    onCommentThreadToggleMouseDown(rootCommentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`comment-thread-toggle:${rootCommentId}`);
        this.toggleCommentReplyThread(rootCommentId, event);
    }

    onCommentThreadToggleClick(rootCommentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`comment-thread-toggle:${rootCommentId}`)) {
            return;
        }

        this.toggleCommentReplyThread(rootCommentId, event);
    }

    startEditComment(comment: CommentDto): void {
        if (!this.canEditComment(comment)) {
            return;
        }

        this.closeMentionSuggestions();
        this.editingCommentId = comment.id;
        this.editCommentContent = comment.content;
    }

    onCommentEditMouseDown(comment: CommentDto, event: MouseEvent): void {
        event.stopPropagation();
        window.setTimeout(() => {
            this.startEditComment(comment);
        }, 0);
    }

    onCommentEditInput(value: string): void {
        this.editCommentContent = value;
    }

    cancelEditComment(event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        this.editingCommentId = null;
        this.editCommentContent = '';
        this.closeMentionSuggestions();
    }

    saveCommentEdit(commentId: string, event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        const content = this.editCommentContent.trim();
        if (!content) {
            return;
        }

        this.updateComment.emit({ commentId, content });
        this.cancelEditComment();
    }

    removeComment(commentId: string): void {
        this.pendingDeleteCommentId = commentId;
    }

    requestReportComment(comment: CommentDto, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        if (!this.canReportComment(comment)) {
            return;
        }

        this.reportComment.emit(comment);
    }

    onDeleteCommentMouseDown(commentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`comment-delete:${commentId}`);
        this.removeComment(commentId);
    }

    onDeleteCommentClick(commentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`comment-delete:${commentId}`)) {
            return;
        }

        this.removeComment(commentId);
    }

    cancelDeleteComment(): void {
        this.pendingDeleteCommentId = null;
    }

    confirmDeleteComment(): void {
        const commentId = this.pendingDeleteCommentId;
        if (!commentId) {
            return;
        }

        this.pendingDeleteCommentId = null;
        this.deleteComment.emit(commentId);
    }

    onCommentPrimaryReaction(comment: CommentDto): void {
        if (!this.canInteract) {
            return;
        }

        if (comment.myReactionType) {
            this.clearCommentReaction.emit(comment.id);
            return;
        }

        this.setCommentReaction.emit({ commentId: comment.id, reactionType: 'Love' });
    }

    onCommentLikeMouseDown(comment: CommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`comment-like:${comment.id}`);
        this.onCommentPrimaryReaction(comment);
    }

    onCommentLikeClick(comment: CommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`comment-like:${comment.id}`)) {
            return;
        }

        this.onCommentPrimaryReaction(comment);
    }

    onCommentReplyMouseDown(comment: CommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled(`comment-reply:${comment.id}`);
        void this.replyToComment(comment);
    }

    onCommentReplyClick(comment: CommentDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled(`comment-reply:${comment.id}`)) {
            return;
        }

        void this.replyToComment(comment);
    }

    onCommentReactionSelected(comment: CommentDto, reactionType: string): void {
        if (!this.canInteract) {
            return;
        }

        if (comment.myReactionType === reactionType) {
            this.clearCommentReaction.emit(comment.id);
            return;
        }

        this.setCommentReaction.emit({ commentId: comment.id, reactionType });
    }

    reactionEmoji(type: string): string {
        const option = this.reactionOptions.find(x => x.type === type);
        return option?.emoji ?? '👍';
    }

    openReactionsModal(event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        if (this.reactionsModalCloseTimerId !== null) {
            window.clearTimeout(this.reactionsModalCloseTimerId);
            this.reactionsModalCloseTimerId = null;
        }

        this.reactionsModalClosing = false;
        this.reactionsModalAnimatingHeight = false;
        this.reactionsModalListHeight = null;
        this.selectedReactionFilter = 'all';
        this.reactionsModalOpen = true;
    }

    onReactionSummaryMouseDown(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.markPointerHandled('post-reactions-summary');
        this.openReactionsModal(event);
    }

    onReactionSummaryClick(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.consumePointerHandled('post-reactions-summary')) {
            return;
        }

        this.openReactionsModal(event);
    }

    closeReactionsModal(): void {
        if (!this.reactionsModalOpen || this.reactionsModalClosing) {
            return;
        }

        this.reactionsModalClosing = true;
        this.reactionsModalCloseTimerId = window.setTimeout(() => {
            this.reactionsModalOpen = false;
            this.reactionsModalClosing = false;
            this.reactionsModalCloseTimerId = null;
            this.reactionsModalAnimatingHeight = false;
            this.reactionsModalListHeight = null;
        }, PostCardComponent.ReactionsModalCloseDurationMs);
    }

    onReactionSummaryKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        this.openReactionsModal(event);
    }

    selectReactionFilter(filterKey: string): void {
        if (this.selectedReactionFilter === filterKey) {
            return;
        }

        this.animateReactionListResize(filterKey);
    }

    onReactionTabMouseDown(filterKey: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.selectReactionFilter(filterKey);
    }

    onReactionTabClick(filterKey: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.selectReactionFilter(filterKey);
    }

    private animateReactionListResize(nextFilterKey: string): void {
        const listElement = this.reactionsModalListRef?.nativeElement;
        if (!listElement) {
            this.selectedReactionFilter = nextFilterKey;
            return;
        }

        const startHeight = listElement.offsetHeight;
        this.selectedReactionFilter = nextFilterKey;

        window.setTimeout(() => {
            const latestListElement = this.reactionsModalListRef?.nativeElement;
            if (!latestListElement) {
                return;
            }

            const endHeight = latestListElement.scrollHeight;
            if (startHeight === endHeight) {
                this.reactionsModalAnimatingHeight = false;
                this.reactionsModalListHeight = null;
                return;
            }

            this.reactionsModalAnimatingHeight = true;
            this.reactionsModalListHeight = startHeight;

            window.requestAnimationFrame(() => {
                this.reactionsModalListHeight = endHeight;
            });

            if (this.reactionsModalResizeTimerId !== null) {
                window.clearTimeout(this.reactionsModalResizeTimerId);
            }

            this.reactionsModalResizeTimerId = window.setTimeout(() => {
                this.reactionsModalAnimatingHeight = false;
                this.reactionsModalListHeight = null;
                this.reactionsModalResizeTimerId = null;
            }, PostCardComponent.ReactionsModalResizeDurationMs);
        }, 0);
    }

    get reactionModalFilters(): Array<{ key: string; type: string; count: number }> {
        const countsByType = new Map<string, number>();

        for (const reaction of this.post?.reactions ?? []) {
            const canonicalType = this.canonicalReactionType(reaction.type);
            countsByType.set(canonicalType, (countsByType.get(canonicalType) ?? 0) + Math.max(0, reaction.count ?? 0));
        }

        if (!countsByType.size && this.totalReactionCount > 0) {
            countsByType.set('Like', this.totalReactionCount);
        }

        const orderedTypes = this.reactionOptions.map(option => this.canonicalReactionType(option.type));
        const filters = orderedTypes
            .filter((type, index, list) => list.indexOf(type) === index)
            .map(type => ({ key: type.toLowerCase(), type, count: countsByType.get(type) ?? 0 }))
            .filter(item => item.count > 0);

        return [{ key: 'all', type: 'All', count: this.totalReactionCount }, ...filters];
    }

    get visibleReactionDetails(): ReactionDetailEntry[] {
        const details = this.allReactionDetails;
        if (!details.length) {
            return [];
        }

        if (this.selectedReactionFilter === 'all') {
            return details;
        }

        return details.filter(detail => this.canonicalReactionType(detail.reactionType).toLowerCase() === this.selectedReactionFilter);
    }

    get reactionDetailsAvailable(): boolean {
        return this.allReactionDetails.length > 0;
    }

    get reactionDetailsEmptyMessage(): string {
        if (!this.reactionDetailsAvailable) {
            return 'Reaction details are not available yet for this post.';
        }

        return 'No people found for this reaction.';
    }

    private get allReactionDetails(): ReactionDetailEntry[] {
        const typedEntries = (this.post?.reactionDetails ?? []) as PostReactionDetailDto[];
        if (typedEntries.length) {
            return typedEntries
                .map(entry => ({
                    profileId: entry.profileId,
                    displayName: entry.displayName,
                    handle: entry.handle,
                    subtitle: entry.bio ?? '',
                    imageUrl: entry.imageUrl ?? '',
                    reactionType: this.canonicalReactionType(entry.reactionType)
                }))
                .sort((left, right) => left.displayName.localeCompare(right.displayName));
        }

        const post = this.post as unknown as Record<string, unknown>;
        const directCandidates = [
            post['reactionDetails'],
            post['reactionUsers'],
            post['reactors'],
            post['reactionEntries'],
            post['reactionsDetailed']
        ];

        let rawEntries: unknown[] = [];
        for (const candidate of directCandidates) {
            if (Array.isArray(candidate)) {
                rawEntries = candidate;
                break;
            }
        }

        if (!rawEntries.length) {
            for (const summary of (this.post?.reactions ?? []) as unknown as Array<Record<string, unknown>>) {
                const nested = summary['users'] ?? summary['profiles'] ?? summary['reactors'] ?? null;
                if (!Array.isArray(nested)) {
                    continue;
                }

                rawEntries.push(...nested.map(entry => ({ ...(entry as Record<string, unknown>), reactionType: summary['type'] })));
            }
        }

        const mapped = rawEntries
            .map(entry => {
                const item = entry as Record<string, unknown>;
                const handle = String(item['handle'] ?? item['userHandle'] ?? item['profileHandle'] ?? '').trim();
                const rawDisplayName = item['displayName'] ?? item['name'] ?? item['userDisplayName'] ?? handle;
                const displayName = String(rawDisplayName || 'Unknown user').trim();
                const subtitle = String(item['subtitle'] ?? item['bio'] ?? item['headline'] ?? item['title'] ?? '').trim();
                const imageUrl = String(item['imageUrl'] ?? item['avatarUrl'] ?? item['userImageUrl'] ?? '').trim();
                const reactionType = this.canonicalReactionType(String(item['reactionType'] ?? item['type'] ?? item['reaction'] ?? 'Like'));
                const profileId = String(item['profileId'] ?? item['id'] ?? handle ?? displayName).trim();

                return {
                    profileId,
                    displayName,
                    handle,
                    subtitle,
                    imageUrl,
                    reactionType
                };
            })
            .filter(entry => !!entry.profileId)
            .sort((left, right) => left.displayName.localeCompare(right.displayName));

        return mapped;
    }

    private canonicalReactionType(type: string | null | undefined): string {
        switch ((type ?? '').trim().toLowerCase()) {
            case 'like':
                return 'Like';
            case 'love':
                return 'Love';
            case 'laugh':
                return 'Laugh';
            case 'wow':
                return 'Wow';
            case 'sad':
                return 'Sad';
            case 'angry':
                return 'Angry';
            case 'partyhorn':
            case 'party-horn':
            case 'party':
                return 'PartyHorn';
            case 'clap':
            case 'hands-clapping':
            case 'handsclapping':
                return 'Clap';
            default:
                return 'Like';
        }
    }

    get topReactionBadges(): PostReactionBadge[] {
        const sorted = [...(this.post?.reactions ?? [])]
            .filter(reaction => reaction.count > 0)
            .sort((left, right) => right.count - left.count)
            .slice(0, 3);

        if (!sorted.length && (this.post?.likeCount ?? 0) > 0) {
            return [{ type: 'Like' }];
        }

        return sorted.map(reaction => ({ type: reaction.type }));
    }

    get totalReactionCount(): number {
        const reactions = this.post?.reactions ?? [];
        const summed = reactions.reduce((total, reaction) => total + Math.max(0, reaction.count ?? 0), 0);

        if (summed > 0) {
            return summed;
        }

        return Math.max(0, this.post?.likeCount ?? 0);
    }

    reactionBadgeClass(type: string): string {
        switch ((type ?? '').trim().toLowerCase()) {
            case 'like':
                return 'type-like';
            case 'love':
                return 'type-love';
            case 'laugh':
                return 'type-laugh';
            case 'wow':
                return 'type-wow';
            case 'sad':
                return 'type-sad';
            case 'angry':
                return 'type-angry';
            case 'partyhorn':
            case 'party-horn':
            case 'party':
                return 'type-partyhorn';
            case 'clap':
            case 'hands-clapping':
            case 'handsclapping':
            case 'fire':
                return 'type-clap';
            default:
                return 'type-default';
        }
    }

    reactionIconClass(type: string): string {
        switch ((type ?? '').trim().toLowerCase()) {
            case 'like':
                return 'fa-duotone fa-solid fa-thumbs-up';
            case 'love':
                return 'fa-duotone fa-solid fa-heart';
            case 'laugh':
                return 'fa-duotone fa-solid fa-face-laugh-squint';
            case 'wow':
                return 'fa-duotone fa-solid fa-face-surprise';
            case 'sad':
                return 'fa-duotone fa-solid fa-face-sad-tear';
            case 'angry':
                return 'fa-duotone fa-solid fa-face-angry';
            case 'partyhorn':
            case 'party-horn':
            case 'party':
                return 'fa-duotone fa-solid fa-party-horn';
            case 'clap':
            case 'hands-clapping':
            case 'handsclapping':
                return 'fa-duotone fa-solid fa-hands-clapping';
            case 'fire':
                return 'fa-duotone fa-solid fa-fire';
            default:
                return 'fa-duotone fa-solid fa-thumbs-up';
        }
    }

    isVideoMedia(url: string | null | undefined): boolean {
        if (!url) {
            return false;
        }

        return /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(url);
    }

    navigateToHashtag(hashtag: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/hashtags', hashtag]);
    }

    navigateToMention(handle: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/users', handle]);
    }

    openSharedPost(shared: SharedPostPreview, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/users', shared.authorHandle], { fragment: `post-${shared.postId}` });
    }

    commentContentLines(content: string): PostContentPart[][] {
        return this.parseContentLines(content ?? '');
    }

    sharedPostContentLines(content: string): PostContentPart[][] {
        return this.parseContentLines(content ?? '');
    }

    triggerShareToFeed(): void {
        if (this.busy || !this.canInteract) {
            return;
        }

        this.shareToFeed.emit();
    }

    triggerShareToChat(): void {
        if (this.busy || !this.canInteract) {
            return;
        }

        this.shareToChat.emit();
    }

    canReportPost(): boolean {
        return !!this.viewerProfileId && this.post.authorId !== this.viewerProfileId;
    }

    triggerReportPost(): void {
        if (!this.canInteract || this.busy || !this.canReportPost()) {
            return;
        }

        this.reportPost.emit();
    }

    async triggerCopyLink(): Promise<void> {
        const postId = this.post?.id;
        if (!postId) {
            return;
        }

        const link = `${window.location.origin}/post/${postId}`;
        try {
            await navigator.clipboard.writeText(link);
            this.ngZone.run(() => {
                this.copyLinkCopied = true;
                if (this.copyLinkResetTimerId !== null) {
                    window.clearTimeout(this.copyLinkResetTimerId);
                }
                this.copyLinkResetTimerId = window.setTimeout(() => {
                    this.ngZone.run(() => {
                        this.copyLinkCopied = false;
                        this.copyLinkResetTimerId = null;
                    });
                }, 2000);
            });
        } catch {
            this.ngZone.run(() => {
                this.copyLink.emit();
            });
        }
    }

    onTextAreaBlur(): void {
        window.setTimeout(() => {
            this.closeMentionSuggestions();
        }, 120);
    }

    async selectMention(profile: ProfileDto): Promise<void> {
        if (!this.mentionOpen || this.mentionRangeStart < 0 || this.mentionRangeEnd < this.mentionRangeStart || !this.mentionTarget) {
            return;
        }

        const replacement = `@${profile.handle} `;
        const nextCaret = this.mentionRangeStart + replacement.length;

        if (this.mentionTarget === 'post-edit') {
            const current = this.editValue;
            const next = `${current.slice(0, this.mentionRangeStart)}${replacement}${current.slice(this.mentionRangeEnd)}`;
            this.editValueChange.emit(next);
            this.closeMentionSuggestions();
            await this.focusMatchingTextarea('.edit-input', nextCaret);
            return;
        }

        if (this.mentionTarget === 'comment-new') {
            const current = this.commentInput;
            this.commentInput = `${current.slice(0, this.mentionRangeStart)}${replacement}${current.slice(this.mentionRangeEnd)}`;
            this.closeMentionSuggestions();
            await this.focusMatchingTextarea('.comment-compose textarea', nextCaret);
            return;
        }

        if (this.mentionTarget === 'comment-edit') {
            const current = this.editCommentContent;
            this.editCommentContent = `${current.slice(0, this.mentionRangeStart)}${replacement}${current.slice(this.mentionRangeEnd)}`;
            const commentId = this.mentionTargetCommentId;
            this.closeMentionSuggestions();

            if (commentId) {
                await this.focusMatchingTextarea(`[data-comment-edit-id="${commentId}"]`, nextCaret);
            }
        }
    }

    private parseContentLines(content: string): PostContentPart[][] {
        return content
            .split(/\r?\n/)
            .map(line => this.parseLineParts(line));
    }

    private refreshVisibleContent(): void {
        if (!this.isContentTruncated || this.contentExpanded) {
            this.contentLines = this.parseContentLines(this.fullContentText);
            return;
        }

        const previewText = `${this.fullContentText.slice(0, PostCardComponent.PostContentPreviewLength).trimEnd()}…`;
        this.contentLines = this.parseContentLines(previewText);
    }

    private normalizePostContentLength(value: string): string {
        if (value.length <= PostCardComponent.MaxPostContentLength) {
            return value;
        }

        return value.slice(0, PostCardComponent.MaxPostContentLength);
    }

    private parseLineParts(line: string): PostContentPart[] {
        const tokenRegex = /#[\p{L}\p{N}_]+|\B@[\p{L}\p{N}_]+/gu;
        const parts: PostContentPart[] = [];
        let cursor = 0;

        for (const match of line.matchAll(tokenRegex)) {
            const rawToken = match[0] ?? '';
            const start = match.index ?? -1;
            if (start < 0) {
                continue;
            }

            if (start > cursor) {
                parts.push({ text: line.slice(cursor, start) });
            }

            if (rawToken.startsWith('#')) {
                parts.push({ text: rawToken, hashtag: rawToken.slice(1) });
            } else {
                parts.push({ text: rawToken, mentionHandle: rawToken.slice(1) });
            }

            cursor = start + rawToken.length;
        }

        if (cursor < line.length) {
            parts.push({ text: line.slice(cursor) });
        }

        if (!parts.length) {
            parts.push({ text: '' });
        }

        return parts;
    }

    private updateMentionSuggestions(target: 'post-edit' | 'comment-new' | 'comment-edit', commentId: string | null, value: string, caret: number): void {
        const context = this.extractMentionContext(value, caret);
        if (!context || !context.query) {
            this.closeMentionSuggestions();
            return;
        }

        this.mentionTarget = target;
        this.mentionTargetCommentId = commentId;
        this.mentionRangeStart = context.start;
        this.mentionRangeEnd = caret;

        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }

        this.mentionLoading = true;
        const token = ++this.mentionSearchToken;
        this.mentionSearchDebounceId = window.setTimeout(async () => {
            this.mentionSearchDebounceId = null;

            try {
                const profiles = await this.session.searchProfilesAsync(context.query);
                if (token !== this.mentionSearchToken) {
                    return;
                }

                const currentHandle = this.session.profile?.handle.toLowerCase() ?? '';
                this.mentionResults = profiles.filter(profile => profile.handle.toLowerCase() !== currentHandle).slice(0, 6);
                this.mentionOpen = this.mentionResults.length > 0;
            } catch {
                if (token !== this.mentionSearchToken) {
                    return;
                }

                this.mentionResults = [];
                this.mentionOpen = false;
            } finally {
                if (token === this.mentionSearchToken) {
                    this.mentionLoading = false;
                }
            }
        }, 200);
    }

    private closeMentionSuggestions(): void {
        this.mentionOpen = false;
        this.mentionResults = [];
        this.mentionLoading = false;
        this.mentionTarget = null;
        this.mentionTargetCommentId = null;
        this.mentionRangeStart = -1;
        this.mentionRangeEnd = -1;
        this.mentionSearchToken += 1;

        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }
    }

    private extractMentionContext(value: string, caret: number): { query: string; start: number } | null {
        const prefix = value.slice(0, caret);
        const match = prefix.match(/(^|\s)@([\p{L}\p{N}_]{1,30})$/u);
        if (!match) {
            return null;
        }

        const query = match[2] ?? '';
        if (!query) {
            return null;
        }

        return {
            query,
            start: caret - query.length - 1
        };
    }

    private async focusMatchingTextarea(selector: string, caret: number): Promise<void> {
        await Promise.resolve();
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLTextAreaElement)) {
            return;
        }

        element.focus();
        element.setSelectionRange(caret, caret);
    }

    private markPointerHandled(key: string): void {
        this.pointerHandledActionKeys.set(key, Date.now() + 700);
    }

    private consumePointerHandled(key: string): boolean {
        const expiresAt = this.pointerHandledActionKeys.get(key);
        if (!expiresAt) {
            return false;
        }

        this.pointerHandledActionKeys.delete(key);
        return expiresAt > Date.now();
    }

    private findCommentRootId(commentId: string): string | null {
        const comments = this.post?.comments ?? [];
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
}