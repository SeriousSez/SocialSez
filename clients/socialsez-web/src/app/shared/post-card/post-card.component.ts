import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommentDto, PostDto } from '../../core/api.types';
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
        this.contentLines = this.parseContentLines(this._content);
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

    readonly reactionOptions = [
        { type: 'Like', emoji: '👍' },
        { type: 'Love', emoji: '❤️' },
        { type: 'Laugh', emoji: '😂' },
        { type: 'Wow', emoji: '😮' },
        { type: 'Sad', emoji: '😢' },
        { type: 'Angry', emoji: '😡' }
    ] as const;

    commentInput = '';
    editingCommentId: string | null = null;
    editCommentContent = '';
    contentLines: PostContentPart[][] = [];
    private _content = '';
    private readonly router = inject(Router);

    ngOnDestroy(): void {
    }

    onPostPrimaryReaction(): void {
        if (this.post.myReactionType) {
            this.clearReaction.emit();
            return;
        }

        this.toggleLike.emit();
    }

    onPostReactionSelected(reactionType: string): void {
        if (reactionType === 'Like') {
            this.onPostPrimaryReaction();
            return;
        }

        if (this.post.myReactionType === reactionType) {
            this.clearReaction.emit();
            return;
        }

        this.setReaction.emit(reactionType);
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

    cancelEditComment(): void {
        this.editingCommentId = null;
        this.editCommentContent = '';
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

        this.setCommentReaction.emit({ commentId: comment.id, reactionType: 'Like' });
    }

    onCommentReactionSelected(comment: CommentDto, reactionType: string): void {
        if (this.busy) {
            return;
        }

        if (reactionType === 'Like') {
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
        void this.router.navigate(['/hashtags', hashtag]);
    }

    private parseContentLines(content: string): PostContentPart[][] {
        return content
            .split(/\r?\n/)
            .map(line => this.parseLineParts(line));
    }

    private parseLineParts(line: string): PostContentPart[] {
        const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
        const parts: PostContentPart[] = [];
        let cursor = 0;

        for (const match of line.matchAll(hashtagRegex)) {
            const rawTag = match[0] ?? '';
            const start = match.index ?? -1;
            if (start < 0) {
                continue;
            }

            if (start > cursor) {
                parts.push({ text: line.slice(cursor, start) });
            }

            parts.push({ text: rawTag, hashtag: rawTag.slice(1) });
            cursor = start + rawTag.length;
        }

        if (cursor < line.length) {
            parts.push({ text: line.slice(cursor) });
        }

        if (!parts.length) {
            parts.push({ text: '' });
        }

        return parts;
    }
}