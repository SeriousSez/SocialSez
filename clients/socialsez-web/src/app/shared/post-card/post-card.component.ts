import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommentDto, PostDto, ProfileDto } from '../../core/api.types';
import { SharedPostPreview, extractSharedPostFromContent } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';
import { ReactionPickerComponent } from '../reaction-picker/reaction-picker.component';

export interface CommentUpdatePayload {
    commentId: string;
    content: string;
}

export interface CommentReactionPayload {
    commentId: string;
    reactionType: string;
}

interface PostContentPart {
    text: string;
    hashtag?: string;
    mentionHandle?: string;
}

@Component({
    selector: 'app-post-card',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactionPickerComponent],
    templateUrl: './post-card.component.html',
    styleUrl: './post-card.component.scss'
})
export class PostCardComponent implements OnDestroy {
    @Input({ required: true }) post!: PostDto;
    @Input()
    set content(value: string) {
        this._content = value ?? '';
        const parsed = extractSharedPostFromContent(this._content);
        this.sharedPost = parsed.sharedPost;
        this.contentLines = this.parseContentLines(parsed.text);
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

    @Output() editValueChange = new EventEmitter<string>();
    @Output() toggleLike = new EventEmitter<void>();
    @Output() setReaction = new EventEmitter<string>();
    @Output() clearReaction = new EventEmitter<void>();
    @Output() startEdit = new EventEmitter<void>();
    @Output() saveEdit = new EventEmitter<void>();
    @Output() cancelEdit = new EventEmitter<void>();
    @Output() deletePost = new EventEmitter<void>();
    @Output() addComment = new EventEmitter<string>();
    @Output() updateComment = new EventEmitter<CommentUpdatePayload>();
    @Output() deleteComment = new EventEmitter<string>();
    @Output() setCommentReaction = new EventEmitter<CommentReactionPayload>();
    @Output() clearCommentReaction = new EventEmitter<string>();
    @Output() shareToFeed = new EventEmitter<void>();
    @Output() shareToChat = new EventEmitter<void>();

    readonly reactionOptions = [
        { type: 'Like', emoji: '👍' },
        { type: 'Love', emoji: '❤️' },
        { type: 'Laugh', emoji: '😂' },
        { type: 'Wow', emoji: '😮' },
        { type: 'Sad', emoji: '😢' },
        { type: 'Angry', emoji: '😡' }
    ] as const;

    commentInput = '';
    commentsOpen = false;
    editingCommentId: string | null = null;
    editCommentContent = '';
    contentLines: PostContentPart[][] = [];
    sharedPost: SharedPostPreview | null = null;
    mentionResults: ProfileDto[] = [];
    mentionOpen = false;
    mentionLoading = false;
    private _content = '';
    private readonly router = inject(Router);
    private readonly session = inject(SessionService);
    mentionTarget: 'post-edit' | 'comment-new' | 'comment-edit' | null = null;
    mentionTargetCommentId: string | null = null;
    private mentionRangeStart = -1;
    private mentionRangeEnd = -1;
    private mentionSearchDebounceId: number | null = null;
    private mentionSearchToken = 0;

    ngOnDestroy(): void {
        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }
    }

    onPostPrimaryReaction(): void {
        if (this.post.myReactionType) {
            this.clearReaction.emit();
            return;
        }

        this.setReaction.emit('Love');
    }

    onPostReactionSelected(reactionType: string): void {
        if (reactionType === 'Love') {
            this.onPostPrimaryReaction();
            return;
        }

        if (this.post.myReactionType === reactionType) {
            this.clearReaction.emit();
            return;
        }

        this.setReaction.emit(reactionType);
    }

    onPostEditInput(value: string, textarea: HTMLTextAreaElement): void {
        this.editValueChange.emit(value);
        this.updateMentionSuggestions('post-edit', null, value, textarea.selectionStart ?? value.length);
    }

    onPostEditCursor(textarea: HTMLTextAreaElement): void {
        this.updateMentionSuggestions('post-edit', null, this.editValue, textarea.selectionStart ?? this.editValue.length);
    }

    submitComment(): void {
        if (this.busy) {
            return;
        }

        const content = this.commentInput.trim();
        if (!content) {
            return;
        }

        this.addComment.emit(content);
        this.commentInput = '';
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
    }

    canEditComment(comment: CommentDto): boolean {
        return !!this.viewerProfileId && comment.authorId === this.viewerProfileId;
    }

    canDeleteComment(comment: CommentDto): boolean {
        if (!this.viewerProfileId) {
            return false;
        }

        return comment.authorId === this.viewerProfileId || this.post.authorId === this.viewerProfileId;
    }

    startEditComment(comment: CommentDto): void {
        if (!this.canEditComment(comment) || this.busy) {
            return;
        }

        this.editingCommentId = comment.id;
        this.editCommentContent = comment.content;
    }

    onCommentEditInput(commentId: string, value: string, textarea: HTMLTextAreaElement): void {
        this.editCommentContent = value;
        this.updateMentionSuggestions('comment-edit', commentId, value, textarea.selectionStart ?? value.length);
    }

    onCommentEditCursor(commentId: string, textarea: HTMLTextAreaElement): void {
        this.updateMentionSuggestions('comment-edit', commentId, this.editCommentContent, textarea.selectionStart ?? this.editCommentContent.length);
    }

    cancelEditComment(): void {
        this.editingCommentId = null;
        this.editCommentContent = '';
        this.closeMentionSuggestions();
    }

    saveCommentEdit(commentId: string): void {
        if (this.busy) {
            return;
        }

        const content = this.editCommentContent.trim();
        if (!content) {
            return;
        }

        this.updateComment.emit({ commentId, content });
        this.cancelEditComment();
    }

    removeComment(commentId: string): void {
        if (this.busy) {
            return;
        }

        this.deleteComment.emit(commentId);
    }

    onCommentPrimaryReaction(comment: CommentDto): void {
        if (this.busy) {
            return;
        }

        if (comment.myReactionType) {
            this.clearCommentReaction.emit(comment.id);
            return;
        }

        this.setCommentReaction.emit({ commentId: comment.id, reactionType: 'Love' });
    }

    onCommentReactionSelected(comment: CommentDto, reactionType: string): void {
        if (this.busy) {
            return;
        }

        if (reactionType === 'Love') {
            this.onCommentPrimaryReaction(comment);
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
        if (this.busy) {
            return;
        }

        this.shareToFeed.emit();
    }

    triggerShareToChat(): void {
        if (this.busy) {
            return;
        }

        this.shareToChat.emit();
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
}