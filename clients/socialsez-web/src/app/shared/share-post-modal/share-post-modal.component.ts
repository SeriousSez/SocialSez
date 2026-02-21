import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PostDto, ProfileDto } from '../../core/api.types';
import { extractSharedPostFromContent } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-share-post-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './share-post-modal.component.html',
    styleUrl: './share-post-modal.component.scss'
})
export class SharePostModalComponent implements OnChanges, OnDestroy {
    private readonly previewMaxChars = 220;

    @Input() open = false;
    @Input() busy = false;
    @Input() target: 'feed' | 'chat' = 'feed';
    @Input() initialText = '';
    @Input() post: PostDto | null = null;

    @Output() confirm = new EventEmitter<string>();
    @Output() cancel = new EventEmitter<void>();

    draft = '';
    mentionResults: ProfileDto[] = [];
    mentionOpen = false;
    mentionLoading = false;
    private mentionRangeStart = -1;
    private mentionRangeEnd = -1;
    private mentionSearchDebounceId: number | null = null;
    private mentionSearchToken = 0;

    @ViewChild('shareTextarea')
    private shareTextareaRef?: ElementRef<HTMLTextAreaElement>;

    constructor(private readonly session: SessionService, private readonly router: Router) { }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.open && !this.busy) {
            this.cancel.emit();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['open']?.currentValue) {
            this.draft = this.initialText;
            this.closeMentionSuggestions();
        }
    }

    ngOnDestroy(): void {
        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }
    }

    onDraftInput(value: string, textarea: HTMLTextAreaElement): void {
        this.draft = value;
        this.updateMentionSuggestions(value, textarea.selectionStart ?? value.length);
    }

    onDraftCursor(textarea: HTMLTextAreaElement): void {
        this.updateMentionSuggestions(this.draft, textarea.selectionStart ?? this.draft.length);
    }

    onDraftBlur(): void {
        window.setTimeout(() => {
            this.closeMentionSuggestions();
        }, 120);
    }

    async selectMention(profile: ProfileDto): Promise<void> {
        if (!this.mentionOpen || this.mentionRangeStart < 0 || this.mentionRangeEnd < this.mentionRangeStart) {
            return;
        }

        const replacement = `@${profile.handle} `;
        this.draft = `${this.draft.slice(0, this.mentionRangeStart)}${replacement}${this.draft.slice(this.mentionRangeEnd)}`;
        const nextCaret = this.mentionRangeStart + replacement.length;
        this.closeMentionSuggestions();

        await Promise.resolve();
        const textarea = this.shareTextareaRef?.nativeElement;
        if (!textarea) {
            return;
        }

        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
    }

    onBackdropClick(event: MouseEvent): void {
        if (this.busy) {
            return;
        }

        const target = event.target as HTMLElement;
        if (target.classList.contains('modal-overlay')) {
            this.cancel.emit();
        }
    }

    submit(): void {
        if (this.busy) {
            return;
        }

        this.confirm.emit(this.draft);
    }

    get title(): string {
        return this.target === 'feed' ? 'Share post' : 'Send post to chat';
    }

    get message(): string {
        return this.target === 'feed'
            ? 'Write something to include with this shared post (optional).'
            : 'Write something to include with this shared message (optional).';
    }

    get confirmText(): string {
        return this.target === 'feed' ? 'Share' : 'Send';
    }

    get previewContent(): string {
        const source = this.previewSource();
        if (!source) {
            return '';
        }

        if (source.length <= this.previewMaxChars) {
            return source;
        }

        return `${source.slice(0, this.previewMaxChars).trimEnd()}…`;
    }

    get isPreviewTruncated(): boolean {
        const source = this.previewSource();
        return source.length > this.previewMaxChars;
    }

    openPreviewPost(event: Event): void {
        event.preventDefault();

        const target = this.previewTarget();
        if (!target) {
            return;
        }

        this.cancel.emit();
        void this.router.navigate(['/users', target.handle], { fragment: `post-${target.postId}` });
    }

    private previewSource(): string {
        const content = this.post?.content?.trim() ?? '';
        if (!content) {
            return '';
        }

        const extracted = extractSharedPostFromContent(content);
        const text = extracted.text.trim();
        if (text) {
            return text;
        }

        if (extracted.sharedPost) {
            return `Shared post from @${extracted.sharedPost.authorHandle}`;
        }

        return content;
    }

    private previewTarget(): { handle: string; postId: string } | null {
        const post = this.post;
        if (!post) {
            return null;
        }

        const extracted = extractSharedPostFromContent(post.content ?? '');
        if (extracted.sharedPost) {
            return {
                handle: extracted.sharedPost.authorHandle,
                postId: extracted.sharedPost.postId
            };
        }

        return {
            handle: post.authorHandle,
            postId: post.id
        };
    }

    private updateMentionSuggestions(value: string, caret: number): void {
        const context = this.extractMentionContext(value, caret);
        if (!context || !context.query) {
            this.closeMentionSuggestions();
            return;
        }

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
}
