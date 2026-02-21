import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PostDto, ProfileDto } from '../../core/api.types';
import { buildSharedPostPreview, encodeSharedPostPayload, extractSharedPostFromContent } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';

interface ShareRecipient {
    id: string;
    handle: string;
    displayName: string;
    imageUrl?: string;
    bio?: string;
}

export interface SharePostMessageSubmit {
    recipientIds: string[];
    note: string;
    mode: 'separate' | 'group';
}

@Component({
    selector: 'app-share-post-message-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './share-post-message-modal.component.html',
    styleUrl: './share-post-message-modal.component.scss'
})
export class SharePostMessageModalComponent implements OnChanges, OnDestroy {
    private readonly previewMaxChars = 220;
    @Input() open = false;
    @Input() busy = false;
    @Input() post: PostDto | null = null;

    @Output() confirm = new EventEmitter<SharePostMessageSubmit>();
    @Output() cancel = new EventEmitter<void>();

    query = '';
    note = '';
    loading = false;
    recipients: ShareRecipient[] = [];
    private remoteRecipients: ShareRecipient[] = [];
    private selectedRecipientIds = new Set<string>();
    private searchDebounceId: number | null = null;
    private searchToken = 0;
    copyFeedback = '';

    constructor(private readonly session: SessionService, private readonly router: Router) { }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.open && !this.busy) {
            this.cancel.emit();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['open']?.currentValue) {
            this.query = '';
            this.note = '';
            this.copyFeedback = '';
            this.remoteRecipients = [];
            this.selectedRecipientIds.clear();
            void this.loadRecipients();
        }
    }

    ngOnDestroy(): void {
        if (this.searchDebounceId !== null) {
            window.clearTimeout(this.searchDebounceId);
            this.searchDebounceId = null;
        }
    }

    get title(): string {
        const handle = this.post?.authorHandle?.trim() ?? '';
        return handle ? `Send @${handle}'s Post` : 'Send Post as Message';
    }

    get visibleRecipients(): ShareRecipient[] {
        const query = this.query.trim().toLowerCase();
        if (!query) {
            return this.recipients;
        }

        const local = this.recipients.filter(recipient => this.matchesQuery(recipient, query));
        const merged = [...local];

        for (const recipient of this.remoteRecipients) {
            if (!merged.some(existing => existing.id === recipient.id)) {
                merged.push(recipient);
            }
        }

        return merged;
    }

    get canSend(): boolean {
        return !this.busy && this.selectedRecipientIds.size > 0;
    }

    get canSendGroup(): boolean {
        return !this.busy && this.selectedRecipientIds.size > 1;
    }

    get selectedCount(): number {
        return this.selectedRecipientIds.size;
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

    isSelected(recipientId: string): boolean {
        return this.selectedRecipientIds.has(recipientId);
    }

    toggleRecipient(recipientId: string): void {
        if (this.busy) {
            return;
        }

        if (this.selectedRecipientIds.has(recipientId)) {
            this.selectedRecipientIds.delete(recipientId);
            return;
        }

        this.selectedRecipientIds.add(recipientId);
    }

    onQueryChange(value: string): void {
        this.query = value;
        this.copyFeedback = '';

        const trimmed = value.trim();
        if (trimmed.length < 2) {
            this.remoteRecipients = [];
            if (this.searchDebounceId !== null) {
                window.clearTimeout(this.searchDebounceId);
                this.searchDebounceId = null;
            }

            this.searchToken += 1;
            return;
        }

        if (this.searchDebounceId !== null) {
            window.clearTimeout(this.searchDebounceId);
            this.searchDebounceId = null;
        }

        const token = ++this.searchToken;
        this.loading = true;
        this.searchDebounceId = window.setTimeout(async () => {
            this.searchDebounceId = null;
            try {
                const found = await this.session.searchProfilesAsync(trimmed);
                if (token !== this.searchToken) {
                    return;
                }

                this.remoteRecipients = this.mapProfiles(found);
            } catch {
                if (token !== this.searchToken) {
                    return;
                }

                this.remoteRecipients = [];
            } finally {
                if (token === this.searchToken) {
                    this.loading = false;
                }
            }
        }, 220);
    }

    submitSeparate(): void {
        if (!this.canSend) {
            return;
        }

        this.confirm.emit({
            recipientIds: [...this.selectedRecipientIds],
            note: this.note,
            mode: 'separate'
        });
    }

    submitGroup(): void {
        if (!this.canSendGroup) {
            return;
        }

        this.confirm.emit({
            recipientIds: [...this.selectedRecipientIds],
            note: this.note,
            mode: 'group'
        });
    }

    async copyPostLink(): Promise<void> {
        if (!this.post) {
            return;
        }

        this.copyFeedback = '';

        const payload = encodeSharedPostPayload(buildSharedPostPreview(this.post));
        const url = `${window.location.origin}/chat?sharePost=${encodeURIComponent(payload)}`;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                const helper = document.createElement('textarea');
                helper.value = url;
                helper.style.position = 'fixed';
                helper.style.opacity = '0';
                document.body.appendChild(helper);
                helper.select();
                document.execCommand('copy');
                document.body.removeChild(helper);
            }

            this.copyFeedback = 'Link copied';
        } catch {
            this.copyFeedback = 'Could not copy link';
        }
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

    private async loadRecipients(): Promise<void> {
        this.loading = true;
        this.searchToken += 1;

        try {
            const [following, conversations] = await Promise.all([
                this.session.loadFollowingAsync(200),
                this.session.loadChatConversationsAsync()
            ]);

            const mappedFollowing = this.mapProfiles(following);
            const fromConversations = conversations
                .flatMap(conversation => conversation.participants)
                .filter(participant => participant.profileId !== this.session.profile?.id)
                .map(participant => ({
                    id: participant.profileId,
                    handle: participant.handle,
                    displayName: participant.displayName,
                    imageUrl: participant.imageUrl,
                    bio: undefined
                } as ShareRecipient));

            const merged = [...mappedFollowing];
            for (const participant of fromConversations) {
                if (!merged.some(existing => existing.id === participant.id)) {
                    merged.push(participant);
                }
            }

            this.recipients = merged.sort((a, b) => a.displayName.localeCompare(b.displayName));
        } catch {
            this.recipients = [];
        } finally {
            this.loading = false;
        }
    }

    private mapProfiles(profiles: ProfileDto[]): ShareRecipient[] {
        const currentProfileId = this.session.profile?.id;
        return profiles
            .filter(profile => profile.id !== currentProfileId)
            .map(profile => ({
                id: profile.id,
                handle: profile.handle,
                displayName: profile.displayName,
                imageUrl: profile.imageUrl,
                bio: profile.bio
            }));
    }

    private matchesQuery(recipient: ShareRecipient, query: string): boolean {
        return recipient.displayName.toLowerCase().includes(query)
            || recipient.handle.toLowerCase().includes(query)
            || (recipient.bio?.toLowerCase().includes(query) ?? false);
    }
}
