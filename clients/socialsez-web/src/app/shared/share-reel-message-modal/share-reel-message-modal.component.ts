import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatConversationDto, ProfileDto, ReelDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

interface ShareRecipient {
    id: string;
    handle: string;
    displayName: string;
    imageUrl?: string;
    bio?: string;
    isGroupChat?: boolean;
    participantHandles?: string[];
}

export interface ShareReelMessageSubmit {
    recipientIds: string[];
    groupChatIds?: string[];
    note: string;
    mode: 'separate' | 'group';
}

@Component({
    selector: 'app-share-reel-message-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './share-reel-message-modal.component.html',
    styleUrl: './share-reel-message-modal.component.scss'
})
export class ShareReelMessageModalComponent implements OnChanges, OnDestroy {
    @Input() open = false;
    @Input() busy = false;
    @Input() reel: ReelDto | null = null;
    @Input() contentKind: 'reel' | 'story' = 'reel';

    @Output() confirm = new EventEmitter<ShareReelMessageSubmit>();
    @Output() cancel = new EventEmitter<void>();

    query = '';
    note = '';
    loading = false;
    recipients: ShareRecipient[] = [];
    previewThumbnailUrl: string | null = null;
    private remoteRecipients: ShareRecipient[] = [];
    private selectedRecipientIds = new Set<string>();
    private searchDebounceId: number | null = null;
    private searchToken = 0;
    private thumbnailToken = 0;

    constructor(private readonly session: SessionService) { }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.open && !this.busy) {
            this.cancel.emit();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['reel']) {
            void this.resolvePreviewThumbnailAsync();
        }

        if (changes['open']?.currentValue) {
            this.query = '';
            this.note = '';
            this.remoteRecipients = [];
            this.selectedRecipientIds.clear();
            void this.resolvePreviewThumbnailAsync();
            void this.loadRecipients();
        }

        if (changes['open'] && !changes['open'].currentValue) {
            this.thumbnailToken += 1;
        }
    }

    ngOnDestroy(): void {
        if (this.searchDebounceId !== null) {
            window.clearTimeout(this.searchDebounceId);
            this.searchDebounceId = null;
        }

        this.thumbnailToken += 1;
    }

    get title(): string {
        const handle = this.reel?.authorHandle?.trim() ?? '';
        if (this.contentKind === 'story') {
            return handle ? `Send @${handle}'s Story` : 'Send Story as Message';
        }

        return handle ? `Send @${handle}'s Reel` : 'Send Reel as Message';
    }

    get contentLabel(): string {
        return this.contentKind === 'story' ? 'story' : 'reel';
    }

    isVideoMediaUrl(url: string | null | undefined): boolean {
        return /\.(mp4|webm|mov|m4v|ogv)(?:\?.*)?$/i.test(url ?? '');
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

        const selectedRecipients = Array.from(this.selectedRecipientIds)
            .map(id => this.recipients.find(r => r.id === id))
            .filter((r): r is ShareRecipient => r !== undefined);

        const groupChatIds = selectedRecipients
            .filter(r => r.isGroupChat)
            .map(r => r.id);

        const profileIds = selectedRecipients
            .filter(r => !r.isGroupChat)
            .map(r => r.id);

        this.confirm.emit({
            recipientIds: profileIds,
            groupChatIds: groupChatIds.length > 0 ? groupChatIds : undefined,
            note: this.note,
            mode: 'separate'
        });
    }

    submitGroup(): void {
        if (!this.canSendGroup) {
            return;
        }

        const selectedRecipients = Array.from(this.selectedRecipientIds)
            .map(id => this.recipients.find(r => r.id === id))
            .filter((r): r is ShareRecipient => r !== undefined);

        const groupChatIds = selectedRecipients
            .filter(r => r.isGroupChat)
            .map(r => r.id);

        const profileIds = selectedRecipients
            .filter(r => !r.isGroupChat)
            .map(r => r.id);

        this.confirm.emit({
            recipientIds: profileIds,
            groupChatIds: groupChatIds.length > 0 ? groupChatIds : undefined,
            note: this.note,
            mode: 'group'
        });
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

            // Add group chats as recipients
            const groupChats = conversations
                .filter(conv => conv.isGroup)
                .map(conv => ({
                    id: conv.id,
                    handle: `group-${conv.id}`,
                    displayName: conv.title || 'Group Chat',
                    imageUrl: undefined,
                    bio: undefined,
                    isGroupChat: true,
                    participantHandles: conv.participants
                        .filter(p => p.profileId !== this.session.profile?.id)
                        .map(p => p.handle)
                } as ShareRecipient));

            const merged = [...mappedFollowing, ...groupChats];
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

    private mapProfiles(profiles: ReadonlyArray<ProfileDto>): ShareRecipient[] {
        return profiles
            .filter(profile => profile.id !== this.session.profile?.id)
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
            || (recipient.participantHandles?.some(handle => handle.toLowerCase().includes(query)) ?? false)
            || (recipient.bio?.toLowerCase().includes(query) ?? false);
    }

    private async resolvePreviewThumbnailAsync(): Promise<void> {
        const reel = this.reel;
        const thumb = reel?.thumbnailUrl?.trim() ?? '';
        if (thumb) {
            this.previewThumbnailUrl = thumb;
            this.thumbnailToken += 1;
            return;
        }

        if (!this.open || !reel?.videoUrl?.trim()) {
            this.previewThumbnailUrl = null;
            return;
        }

        this.previewThumbnailUrl = null;
        const token = ++this.thumbnailToken;
        const generated = await this.captureVideoThumbnailAsync(reel.videoUrl);
        if (token !== this.thumbnailToken || !this.open) {
            return;
        }

        this.previewThumbnailUrl = generated;
    }

    private captureVideoThumbnailAsync(videoUrl: string): Promise<string | null> {
        return new Promise(resolve => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.crossOrigin = 'anonymous';

            const cleanup = () => {
                video.removeEventListener('loadeddata', onLoadedData);
                video.removeEventListener('error', onError);
                window.clearTimeout(timeoutId);
                video.pause();
                video.removeAttribute('src');
                video.load();
            };

            const onError = () => {
                cleanup();
                resolve(null);
            };

            const onLoadedData = () => {
                try {
                    const sourceWidth = video.videoWidth;
                    const sourceHeight = video.videoHeight;
                    if (!sourceWidth || !sourceHeight) {
                        cleanup();
                        resolve(null);
                        return;
                    }

                    const maxWidth = 640;
                    const scale = Math.min(1, maxWidth / sourceWidth);
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
                    canvas.height = Math.max(1, Math.round(sourceHeight * scale));

                    const context = canvas.getContext('2d');
                    if (!context) {
                        cleanup();
                        resolve(null);
                        return;
                    }

                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                    cleanup();
                    resolve(dataUrl);
                } catch {
                    cleanup();
                    resolve(null);
                }
            };

            const timeoutId = window.setTimeout(() => {
                cleanup();
                resolve(null);
            }, 5000);

            video.addEventListener('loadeddata', onLoadedData, { once: true });
            video.addEventListener('error', onError, { once: true });
            video.src = videoUrl;
        });
    }
}
