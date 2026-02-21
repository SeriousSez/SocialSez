import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, ElementRef, HostListener, Input, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ChatConversationDto, ChatMessageDto, ChatParticipantDto } from '../core/api.types';
import { SharedPostPreview, decodeSharedPostPayload, extractSharedPostFromContent } from '../core/shared-post.utils';
import { SessionService } from '../core/session.service';
import { ReactionPickerComponent } from '../shared/reaction-picker/reaction-picker.component';
import { SkeletonComponent } from '../shared/skeleton/skeleton.component';
import 'emoji-picker-element';

interface ParsedDockMessage {
    text: string;
    imageUrl?: string;
    gifUrl?: string;
    sharedPost?: SharedPostPreview;
}

interface GiphyGifResult {
    id: string;
    title: string;
    previewUrl: string;
    originalUrl: string;
}

@Component({
    selector: 'app-messages-dock',
    standalone: true,
    imports: [CommonModule, FormsModule, SkeletonComponent, ReactionPickerComponent],
    templateUrl: './messages-dock.component.html',
    styleUrl: './messages-dock.component.scss',
    schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class MessagesDockComponent {
    @Input() visible = false;
    private readonly giphyApiKey = 'iY9dDrlVL8teP0Csu3Y1Fcq3AbyCPPmg';
    private readonly sharedPreviewMaxChars = 220;
    private readonly reactionEmojiMap: Record<string, string> = {
        Like: '👍',
        Love: '❤️',
        Laugh: '😂',
        Wow: '😮',
        Sad: '😢',
        Angry: '😡',
        Fire: '🔥',
        Party: '🎉'
    };
    readonly noReactions: ReadonlyArray<{ type: string; count: number }> = [];
    readonly reactionOptions = [
        { type: 'Like', emoji: '👍' },
        { type: 'Love', emoji: '❤️' },
        { type: 'Laugh', emoji: '😂' },
        { type: 'Wow', emoji: '😮' },
        { type: 'Sad', emoji: '😢' },
        { type: 'Angry', emoji: '😡' },
        { type: 'Fire', emoji: '🔥' },
        { type: 'Party', emoji: '🎉' }
    ] as const;

    open = false;
    loading = false;
    loadingMessages = false;
    sendingMessage = false;
    uploadingImage = false;
    reactingMessageId: string | null = null;
    status = '';
    conversations: ChatConversationDto[] = [];
    activeConversation: ChatConversationDto | null = null;
    messages: ChatMessageDto[] = [];
    draftMessage = '';
    gifSearchQuery = '';
    gifResults: GiphyGifResult[] = [];
    searchingGifs = false;
    imageUrlInput: string | null = null;
    gifUrlInput = '';
    emojiPickerOpen = false;
    gifInputOpen = false;

    @ViewChild('dockImageInput')
    private imageInputRef?: ElementRef<HTMLInputElement>;

    @ViewChild('emojiPickerWrap')
    private emojiPickerWrapRef?: ElementRef<HTMLElement>;

    @ViewChild('emojiToggleBtn')
    private emojiToggleBtnRef?: ElementRef<HTMLButtonElement>;

    @ViewChild('gifOverlayWrap')
    private gifOverlayWrapRef?: ElementRef<HTMLElement>;

    @ViewChild('gifToggleBtn')
    private gifToggleBtnRef?: ElementRef<HTMLButtonElement>;

    @ViewChild('threadList')
    private threadListRef?: ElementRef<HTMLDivElement>;

    constructor(private readonly session: SessionService, private readonly router: Router) { }

    toggle(event?: Event): void {
        event?.stopPropagation();
        if (!this.visible) {
            return;
        }

        this.open = !this.open;
        if (this.open) {
            void this.loadConversations();
        }
    }

    close(event?: Event): void {
        event?.stopPropagation();
        this.open = false;
        this.activeConversation = null;
        this.messages = [];
        this.draftMessage = '';
        this.imageUrlInput = null;
        this.gifUrlInput = '';
        this.gifInputOpen = false;
        this.emojiPickerOpen = false;
    }

    async openFullChat(conversationId?: string, event?: Event): Promise<void> {
        event?.stopPropagation();
        this.open = false;

        await this.router.navigate(['/chat'], conversationId
            ? { queryParams: { conversation: conversationId } }
            : undefined);
    }

    async openConversation(conversation: ChatConversationDto, event?: Event): Promise<void> {
        event?.stopPropagation();
        if (this.loadingMessages) {
            return;
        }

        this.activeConversation = conversation;
        this.messages = [];
        this.draftMessage = '';
        this.imageUrlInput = null;
        this.gifUrlInput = '';
        this.gifInputOpen = false;
        this.emojiPickerOpen = false;
        this.loadingMessages = true;
        this.status = '';

        try {
            const loaded = await this.session.loadChatMessagesAsync(conversation.id);
            this.messages = [...loaded].sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
            if (this.messages.length) {
                this.scrollThreadToBottomOnNextRender();
            }
        } catch {
            this.messages = [];
            this.status = 'Could not load messages.';
        } finally {
            this.loadingMessages = false;
        }
    }

    backToList(event?: Event): void {
        event?.stopPropagation();
        this.activeConversation = null;
        this.messages = [];
        this.draftMessage = '';
        this.imageUrlInput = null;
        this.gifUrlInput = '';
        this.gifInputOpen = false;
        this.emojiPickerOpen = false;
        this.status = '';
    }

    async sendMessage(event?: Event): Promise<void> {
        event?.stopPropagation();
        const conversation = this.activeConversation;
        const content = this.composeOutgoingMessage();
        if (!conversation || !content || this.sendingMessage) {
            return;
        }

        this.sendingMessage = true;
        this.status = '';

        try {
            const created = await this.session.sendChatMessageAsync(conversation.id, content);
            this.messages = [...this.messages, created].sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
            this.scrollThreadToBottomOnNextRender();
            this.draftMessage = '';
            this.imageUrlInput = null;
            this.gifUrlInput = '';
            this.gifInputOpen = false;
            this.emojiPickerOpen = false;
            this.updateConversationPreview(created);
        } catch {
            this.status = 'Could not send message.';
        } finally {
            this.sendingMessage = false;
        }
    }

    @HostListener('document:pointerdown', ['$event'])
    onDocumentPointerDown(event: PointerEvent): void {
        if (!this.open || (!this.emojiPickerOpen && !this.gifInputOpen)) {
            return;
        }

        const path = event.composedPath();
        const isInside = (element: Element | null | undefined): boolean => !!element && path.includes(element);

        const picker = this.emojiPickerWrapRef?.nativeElement;
        if (this.emojiPickerOpen && isInside(picker)) {
            return;
        }

        const toggle = this.emojiToggleBtnRef?.nativeElement;
        if (this.emojiPickerOpen && isInside(toggle)) {
            return;
        }

        const gifOverlay = this.gifOverlayWrapRef?.nativeElement;
        if (this.gifInputOpen && isInside(gifOverlay)) {
            return;
        }

        const gifToggle = this.gifToggleBtnRef?.nativeElement;
        if (this.gifInputOpen && isInside(gifToggle)) {
            return;
        }

        this.emojiPickerOpen = false;
        this.gifInputOpen = false;
    }

    appendEmoji(emoji: string): void {
        this.draftMessage = `${this.draftMessage}${emoji}`;
    }

    onEmojiPicked(event: Event): void {
        const detail = (event as CustomEvent<{ unicode?: string; emoji?: { unicode?: string } | string }>).detail;
        const unicode = typeof detail?.emoji === 'string'
            ? detail.emoji
            : detail?.emoji?.unicode ?? detail?.unicode;

        if (!unicode) {
            return;
        }

        this.appendEmoji(unicode);
    }

    toggleEmojiPicker(): void {
        this.emojiPickerOpen = !this.emojiPickerOpen;
        if (this.emojiPickerOpen) {
            this.gifInputOpen = false;
        }
    }

    toggleGifInput(): void {
        this.gifInputOpen = !this.gifInputOpen;
        if (this.gifInputOpen) {
            this.emojiPickerOpen = false;
            this.gifResults = [];
            this.gifSearchQuery = '';
            void this.loadTrendingGifs();
        }
    }

    async searchGifs(): Promise<void> {
        const query = this.gifSearchQuery.trim();
        if (!query) {
            await this.loadTrendingGifs();
            return;
        }

        this.searchingGifs = true;
        this.status = '';

        try {
            const url = new URL('https://api.giphy.com/v1/gifs/search');
            url.searchParams.set('api_key', this.giphyApiKey);
            url.searchParams.set('q', query);
            url.searchParams.set('limit', '12');
            url.searchParams.set('offset', '0');
            url.searchParams.set('rating', 'pg-13');
            url.searchParams.set('lang', 'en');

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error('GIF search failed.');
            }

            const payload = await response.json() as {
                data?: Array<{
                    id?: string;
                    title?: string;
                    images?: {
                        fixed_height?: { url?: string };
                        original?: { url?: string };
                    };
                }>;
            };

            this.gifResults = this.mapGiphyResults(payload.data);
        } catch {
            this.status = 'Could not load GIFs from Giphy.';
            this.gifResults = [];
        } finally {
            this.searchingGifs = false;
        }
    }

    async selectGif(gif: GiphyGifResult): Promise<void> {
        this.gifUrlInput = gif.originalUrl;
        this.gifInputOpen = false;
        this.gifSearchQuery = '';
        this.gifResults = [];

        if (!this.sendingMessage && this.activeConversation) {
            await this.sendMessage();
        }
    }

    openImagePicker(): void {
        this.imageInputRef?.nativeElement.click();
    }

    async onImageSelected(event: Event): Promise<void> {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0];
        if (!file || this.uploadingImage) {
            return;
        }

        this.uploadingImage = true;
        this.status = '';

        try {
            this.imageUrlInput = await this.session.uploadImageAsync(file);
            if (!this.sendingMessage && this.activeConversation) {
                await this.sendMessage();
            }
        } catch {
            this.status = 'Could not upload image.';
        } finally {
            this.uploadingImage = false;
            if (target) {
                target.value = '';
            }
        }
    }

    clearComposerImage(): void {
        this.imageUrlInput = null;
    }

    clearComposerGif(): void {
        this.gifUrlInput = '';
        this.gifSearchQuery = '';
        this.gifResults = [];
    }

    hasComposerMedia(): boolean {
        return !!this.composerImageUrl() || !!this.composerGifUrl();
    }

    composerGifUrl(): string | null {
        const normalized = this.normalizedMediaUrl(this.gifUrlInput);
        if (!normalized || !this.isGifUrl(normalized)) {
            return null;
        }

        return normalized;
    }

    composerImageUrl(): string | null {
        return this.imageUrlInput ? this.normalizedMediaUrl(this.imageUrlInput) : null;
    }

    messageAuthorLabel(message: ChatMessageDto): string {
        return this.session.profile?.id === message.authorProfileId ? 'You' : `@${message.authorHandle}`;
    }

    isOwnMessage(message: ChatMessageDto): boolean {
        return this.session.profile?.id === message.authorProfileId;
    }

    parsedMessage(content: string): ParsedDockMessage {
        const lines = (content ?? '').split(/\r?\n/);
        const textLines: string[] = [];
        let imageUrl: string | undefined;
        let gifUrl: string | undefined;
        let sharedPost: SharedPostPreview | undefined;

        for (const rawLine of lines) {
            const line = rawLine.trim();

            if (line.startsWith('[image]')) {
                const url = line.slice(7).trim();
                if (url) {
                    imageUrl = url;
                }
                continue;
            }

            if (line.startsWith('[gif]')) {
                const url = line.slice(5).trim();
                if (url) {
                    gifUrl = url;
                }
                continue;
            }

            if (line.startsWith('[post]')) {
                const parsed = decodeSharedPostPayload(line.slice(6));
                if (parsed) {
                    sharedPost = parsed;
                    continue;
                }
            }

            textLines.push(rawLine);
        }

        return {
            text: textLines.join('\n').trim(),
            imageUrl,
            gifUrl,
            sharedPost
        };
    }

    messageVariant(content: string): 'default' | 'shared-only' | 'media-only' {
        const parsed = this.parsedMessage(content);
        if (parsed.sharedPost && !parsed.text && !parsed.imageUrl && !parsed.gifUrl) {
            return 'shared-only';
        }

        if (!parsed.text && !parsed.sharedPost && (!!parsed.imageUrl || !!parsed.gifUrl)) {
            return 'media-only';
        }

        return 'default';
    }

    sharedPreviewContent(content: string): string {
        const source = (content ?? '').trim();
        if (!source) {
            return '';
        }

        if (source.length <= this.sharedPreviewMaxChars) {
            return source;
        }

        return `${source.slice(0, this.sharedPreviewMaxChars).trimEnd()}…`;
    }

    reactionEmoji(type: string): string {
        return this.reactionEmojiMap[type] ?? '👍';
    }

    async onMessagePrimaryReaction(message: ChatMessageDto): Promise<void> {
        if (message.myReactionType) {
            await this.clearMessageReaction(message);
            return;
        }

        await this.setMessageReaction(message, 'Love');
    }

    async onMessageReactionSelected(message: ChatMessageDto, reactionType: string): Promise<void> {
        if (reactionType === 'Love') {
            await this.onMessagePrimaryReaction(message);
            return;
        }

        if (message.myReactionType === reactionType) {
            await this.clearMessageReaction(message);
            return;
        }

        await this.setMessageReaction(message, reactionType);
    }

    openSharedPost(shared: SharedPostPreview, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.open = false;
        void this.router.navigate(['/users', shared.authorHandle], { fragment: `post-${shared.postId}` });
    }

    trackByConversationId(_: number, conversation: ChatConversationDto): string {
        return conversation.id;
    }

    trackByMessageId(_: number, message: ChatMessageDto): string {
        return message.id;
    }

    displayName(conversation: ChatConversationDto): string {
        if (conversation.title?.trim()) {
            return conversation.title;
        }

        return this.primaryParticipant(conversation)?.displayName ?? 'Direct chat';
    }

    displayHandle(conversation: ChatConversationDto): string {
        return this.primaryParticipant(conversation)?.handle ?? '';
    }

    avatarText(conversation: ChatConversationDto): string {
        const title = this.displayName(conversation).trim();
        return title ? title[0].toUpperCase() : 'C';
    }

    avatarUrl(conversation: ChatConversationDto): string | undefined {
        return this.primaryParticipant(conversation)?.imageUrl;
    }

    preview(conversation: ChatConversationDto): string {
        if (!conversation.lastMessage) {
            return 'No messages yet';
        }

        return `${conversation.lastMessage.authorHandle}: ${this.previewContent(conversation.lastMessage.content)}`;
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        this.emojiPickerOpen = false;
        this.gifInputOpen = false;
        this.open = false;
    }

    private composeOutgoingMessage(): string {
        const text = this.draftMessage.trim();
        const gifUrl = this.composerGifUrl();
        const imageUrl = this.composerImageUrl();

        const parts: string[] = [];

        if (text) {
            parts.push(text);
        }

        if (gifUrl) {
            parts.push(`[gif]${gifUrl}`);
        }

        if (imageUrl) {
            parts.push(`[image]${imageUrl}`);
        }

        return parts.join('\n').trim();
    }

    private async loadConversations(): Promise<void> {
        if (this.loading) {
            return;
        }

        this.loading = true;
        this.status = '';

        try {
            this.conversations = await this.session.loadChatConversationsAsync();
        } catch {
            this.conversations = [];
            this.status = 'Could not load messages.';
        } finally {
            this.loading = false;
        }
    }

    private primaryParticipant(conversation: ChatConversationDto): ChatParticipantDto | undefined {
        const currentProfileId = this.session.profile?.id;
        return conversation.participants.find(x => x.profileId !== currentProfileId) ?? conversation.participants[0];
    }

    private updateConversationPreview(message: ChatMessageDto): void {
        const authorHandle = this.session.profile?.id === message.authorProfileId
            ? (this.session.profile?.handle ?? message.authorHandle)
            : message.authorHandle;

        this.conversations = this.conversations
            .map(conversation => {
                if (conversation.id !== message.conversationId) {
                    return conversation;
                }

                return {
                    ...conversation,
                    lastMessage: {
                        id: message.id,
                        authorProfileId: message.authorProfileId,
                        authorHandle,
                        content: this.previewContent(message.content),
                        createdAtUtc: message.createdAtUtc
                    }
                };
            })
            .sort((left, right) => {
                const leftAt = left.lastMessage?.createdAtUtc ?? left.createdAtUtc;
                const rightAt = right.lastMessage?.createdAtUtc ?? right.createdAtUtc;
                return rightAt.localeCompare(leftAt);
            });

        if (this.activeConversation?.id === message.conversationId) {
            this.activeConversation = this.conversations.find(x => x.id === message.conversationId) ?? this.activeConversation;
        }
    }

    private async setMessageReaction(message: ChatMessageDto, reactionType: string): Promise<void> {
        if (this.reactingMessageId || this.loadingMessages) {
            return;
        }

        this.reactingMessageId = message.id;
        this.status = '';

        try {
            const updated = await this.session.setMessageReactionAsync(message.id, reactionType);
            this.applyMessageUpdate(updated);
        } catch {
            this.status = 'Could not set reaction.';
        } finally {
            this.reactingMessageId = null;
        }
    }

    private async clearMessageReaction(message: ChatMessageDto): Promise<void> {
        if (this.reactingMessageId || this.loadingMessages) {
            return;
        }

        this.reactingMessageId = message.id;
        this.status = '';

        try {
            const updated = await this.session.clearMessageReactionAsync(message.id);
            this.applyMessageUpdate(updated);
        } catch {
            this.status = 'Could not clear reaction.';
        } finally {
            this.reactingMessageId = null;
        }
    }

    private applyMessageUpdate(updated: ChatMessageDto): void {
        if (this.activeConversation?.id !== updated.conversationId) {
            return;
        }

        const index = this.messages.findIndex(message => message.id === updated.id);
        if (index < 0) {
            this.messages = [...this.messages, updated]
                .sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
            this.scrollThreadToBottomOnNextRender();
            return;
        }

        const next = [...this.messages];
        next[index] = updated;
        this.messages = next;
    }

    private scrollThreadToBottomOnNextRender(): void {
        const maxAttempts = 10;

        const scrollToBottom = (attemptsLeft: number, previousHeight = -1) => {
            const container = this.threadListRef?.nativeElement;
            if (!container) {
                if (attemptsLeft > 0) {
                    window.setTimeout(() => scrollToBottom(attemptsLeft - 1, previousHeight), 80);
                }
                return;
            }

            container.scrollTop = container.scrollHeight;

            if (attemptsLeft <= 0) {
                return;
            }

            const currentHeight = container.scrollHeight;
            if (currentHeight !== previousHeight) {
                window.setTimeout(() => scrollToBottom(attemptsLeft - 1, currentHeight), 80);
            }
        };

        requestAnimationFrame(() => scrollToBottom(maxAttempts));
    }

    private previewContent(content: string): string {
        const extracted = extractSharedPostFromContent(content ?? '');
        const text = extracted.text.trim();

        if (text) {
            return text;
        }

        if (extracted.sharedPost) {
            return `Shared post from @${extracted.sharedPost.authorHandle}`;
        }

        const lines = (content ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const hasImage = lines.some(line => line.startsWith('[image]'));
        const hasGif = lines.some(line => line.startsWith('[gif]'));

        if (hasImage && hasGif) {
            return 'GIF · Image';
        }

        if (hasGif) {
            return 'GIF';
        }

        if (hasImage) {
            return 'Image';
        }

        return '';
    }

    private async loadTrendingGifs(): Promise<void> {
        this.searchingGifs = true;
        this.status = '';

        try {
            const url = new URL('https://api.giphy.com/v1/gifs/trending');
            url.searchParams.set('api_key', this.giphyApiKey);
            url.searchParams.set('limit', '12');
            url.searchParams.set('offset', '0');
            url.searchParams.set('rating', 'pg-13');

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error('GIF trending load failed.');
            }

            const payload = await response.json() as {
                data?: Array<{
                    id?: string;
                    title?: string;
                    images?: {
                        fixed_height?: { url?: string };
                        original?: { url?: string };
                    };
                }>;
            };

            this.gifResults = this.mapGiphyResults(payload.data);
        } catch {
            this.status = 'Could not load trending GIFs.';
            this.gifResults = [];
        } finally {
            this.searchingGifs = false;
        }
    }

    private mapGiphyResults(data: Array<{
        id?: string;
        title?: string;
        images?: {
            fixed_height?: { url?: string };
            original?: { url?: string };
        };
    }> | undefined): GiphyGifResult[] {
        return (data ?? [])
            .map(item => {
                const previewUrl = item.images?.fixed_height?.url ?? '';
                const originalUrl = item.images?.original?.url ?? previewUrl;

                return {
                    id: item.id ?? originalUrl,
                    title: item.title ?? 'GIF',
                    previewUrl,
                    originalUrl
                };
            })
            .filter(item => !!item.previewUrl && !!item.originalUrl);
    }

    private normalizedMediaUrl(value: string): string | null {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        try {
            const url = new URL(trimmed);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return null;
            }

            return url.toString();
        } catch {
            return null;
        }
    }

    private isGifUrl(url: string): boolean {
        const lower = url.toLowerCase();
        return /\.gif($|\?)/.test(lower) || lower.includes('giphy.com') || lower.includes('tenor.com');
    }
}
