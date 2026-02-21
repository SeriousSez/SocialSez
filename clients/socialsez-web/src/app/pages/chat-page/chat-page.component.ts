import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, DestroyRef, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ChatConversationDto, ChatMessageDto, ChatParticipantDto, ProfileDto, ReactionSummaryDto } from '../../core/api.types';
import { ChatRealtimeService } from '../../core/chat-realtime.service';
import { SharedPostPreview, buildSharedPostMarker, decodeSharedPostPayload } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';
import { ChatSearchModalComponent } from '../../shared/chat-search-modal/chat-search-modal.component';
import { ReactionPickerComponent } from '../../shared/reaction-picker/reaction-picker.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import 'emoji-picker-element';

interface ParsedChatMessage {
    text: string;
    imageUrl?: string;
    gifUrl?: string;
    sharedPost?: SharedPostPreview;
}

interface RichTextPart {
    text: string;
    hashtag?: string;
    mentionHandle?: string;
}

interface GiphyGifResult {
    id: string;
    title: string;
    previewUrl: string;
    originalUrl: string;
}

@Component({
    selector: 'app-chat-page',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactionPickerComponent, SkeletonComponent, ChatSearchModalComponent],
    templateUrl: './chat-page.component.html',
    styleUrl: './chat-page.component.scss',
    schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class ChatPageComponent implements OnDestroy {
    private readonly giphyApiKey = 'iY9dDrlVL8teP0Csu3Y1Fcq3AbyCPPmg';
    private readonly messageGapForTimeBreakMs = 30 * 60 * 1000;
    private readonly messageGapForCompactMs = 5 * 60 * 1000;
    private readonly sharedPreviewMaxChars = 320;
    private readonly sharedPreviewMaxLines = 7;
    private readonly composerMinHeightPx = 38;
    private readonly composerMaxHeightPx = 120;
    readonly noReactions: ReadonlyArray<ReactionSummaryDto> = [];
    readonly suggestedStarterMessages = [
        'Hey 👋',
        'How are you doing today?',
        'Want to catch up later?'
    ] as const;
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

    conversations: ChatConversationDto[] = [];
    filteredProfiles: ProfileDto[] = [];
    suggestedFollowingProfiles: ProfileDto[] = [];
    suggestedRelevantProfiles: ProfileDto[] = [];
    messages: ChatMessageDto[] = [];

    loadingConversations = true;
    loadingMessages = false;
    sendingMessage = false;
    startingDirectChat = false;
    reactingMessageId: string | null = null;
    searchingProfiles = false;
    loadingProfileSuggestions = false;
    chatSearchModalOpen = false;
    searchUsersError = '';

    selectedConversationId: string | null = null;
    selectedConversation: ChatConversationDto | null = null;

    searchUsersQuery = '';
    modalSearchUsersQuery = '';
    messageSearchQuery = '';
    newMessage = '';
    gifUrlInput = '';
    gifSearchQuery = '';
    gifResults: GiphyGifResult[] = [];
    searchingGifs = false;
    imageUrlInput: string | null = null;
    sharedPostInput: SharedPostPreview | null = null;
    emojiPickerOpen = false;
    gifInputOpen = false;
    uploadingImage = false;
    status = '';

    readonly prefers24HourClock = (() => {
        const hourCycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
        return hourCycle === 'h23' || hourCycle === 'h24';
    })();

    @ViewChild('messageList')
    private messageListRef?: ElementRef<HTMLDivElement>;

    @ViewChild('chatImageInput')
    private imageInputRef?: ElementRef<HTMLInputElement>;

    @ViewChild('emojiPickerWrap')
    private emojiPickerWrapRef?: ElementRef<HTMLElement>;

    @ViewChild('emojiToggleBtn')
    private emojiToggleBtnRef?: ElementRef<HTMLButtonElement>;

    @ViewChild('gifOverlayWrap')
    private gifOverlayWrapRef?: ElementRef<HTMLElement>;

    @ViewChild('gifToggleBtn')
    private gifToggleBtnRef?: ElementRef<HTMLButtonElement>;

    @ViewChild('composerInput')
    private composerInputRef?: ElementRef<HTMLTextAreaElement>;

    private readonly destroyRef = inject(DestroyRef);
    private readonly ngZone = inject(NgZone);
    private searchProfilesDebounceId: number | null = null;

    constructor(private readonly session: SessionService, private readonly chatRealtime: ChatRealtimeService, private readonly route: ActivatedRoute, private readonly router: Router) {
        this.chatRealtime.messageUpserted$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((message) => {
                this.upsertMessage(message);
                this.applyConversationPreview(message);
            });

        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                const payload = (params.get('sharePost') ?? '').trim();
                const shareText = (params.get('shareText') ?? '').trim();

                if (shareText) {
                    this.newMessage = shareText;
                }

                if (!payload) {
                    return;
                }

                const parsed = decodeSharedPostPayload(payload);
                if (!parsed) {
                    return;
                }

                this.sharedPostInput = parsed;
            });

        void this.loadConversations();
    }

    ngOnDestroy(): void {
        if (this.searchProfilesDebounceId !== null) {
            window.clearTimeout(this.searchProfilesDebounceId);
            this.searchProfilesDebounceId = null;
        }

        const activeConversationId = this.selectedConversationId;
        if (!activeConversationId) {
            void this.chatRealtime.disconnect();
            return;
        }

        void this.chatRealtime.leaveConversation(activeConversationId)
            .finally(() => this.chatRealtime.disconnect());
    }

    @HostListener('document:pointerdown', ['$event'])
    onDocumentPointerDown(event: PointerEvent): void {
        if (!this.emojiPickerOpen && !this.gifInputOpen) {
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

    get currentProfileId(): string | null {
        return this.session.profile?.id ?? null;
    }

    get visibleMessages(): ChatMessageDto[] {
        const query = this.messageSearchQuery.trim().toLowerCase();
        if (!query) {
            return this.messages;
        }

        return this.messages.filter(message =>
            this.messageSearchIndex(message.content).includes(query)
            || message.authorHandle.toLowerCase().includes(query));
    }

    get filteredConversations(): ChatConversationDto[] {
        const query = this.searchUsersQuery.trim().toLowerCase();
        const withMessages = this.conversations.filter(conversation => !!conversation.lastMessage?.id);
        if (!query) {
            return withMessages;
        }

        const currentProfileId = this.currentProfileId;
        return withMessages.filter(conversation => {
            const title = this.conversationTitle(conversation).toLowerCase();
            const participantPool = conversation.participants.filter(participant => participant.profileId !== currentProfileId);
            const participants = (participantPool.length ? participantPool : conversation.participants)
                .map(participant => `${participant.displayName} ${participant.handle}`.toLowerCase())
                .join(' ');
            const lastMessage = conversation.lastMessage?.content?.toLowerCase() ?? '';

            return title.includes(query)
                || participants.includes(query)
                || lastMessage.includes(query);
        });
    }

    async loadConversations(): Promise<void> {
        this.loadingConversations = true;
        this.status = '';

        try {
            this.conversations = await this.session.loadChatConversationsAsync();

            if (this.selectedConversationId) {
                const updatedSelection = this.conversations.find(x => x.id === this.selectedConversationId) ?? null;
                if (updatedSelection) {
                    this.selectedConversation = updatedSelection;
                }
            }

            const requestedConversationId = this.route.snapshot.queryParamMap.get('conversation');
            if (requestedConversationId) {
                const requestedConversation = this.conversations.find(x => x.id === requestedConversationId);
                if (requestedConversation && this.selectedConversationId !== requestedConversation.id) {
                    await this.selectConversation(requestedConversation);
                    return;
                }
            }

        } catch {
            this.status = 'Could not load conversations.';
            this.conversations = [];
        } finally {
            this.loadingConversations = false;
        }
    }

    onSearchUsersInput(value: string): void {
        this.searchUsersQuery = value;
    }

    onModalSearchUsersInput(value: string): void {
        this.modalSearchUsersQuery = value;
        this.searchUsersError = '';

        const query = value.trim();
        if (!query) {
            this.filteredProfiles = [];
            this.searchingProfiles = false;
            if (this.searchProfilesDebounceId !== null) {
                window.clearTimeout(this.searchProfilesDebounceId);
                this.searchProfilesDebounceId = null;
            }
            void this.loadProfileSuggestions();
            return;
        }

        this.chatSearchModalOpen = true;
        this.scheduleProfileSearch(query);
    }

    openChatSearchModal(): void {
        this.chatSearchModalOpen = true;
        this.searchUsersError = '';

        const query = this.modalSearchUsersQuery.trim();
        if (query && !this.searchingProfiles) {
            this.scheduleProfileSearch(query);
            return;
        }

        void this.loadProfileSuggestions();
    }

    closeChatSearchModal(clearQuery = false): void {
        this.chatSearchModalOpen = false;
        this.searchUsersError = '';

        if (this.searchProfilesDebounceId !== null) {
            window.clearTimeout(this.searchProfilesDebounceId);
            this.searchProfilesDebounceId = null;
        }

        if (clearQuery) {
            this.modalSearchUsersQuery = '';
            this.filteredProfiles = [];
            this.searchingProfiles = false;
        }
    }

    async selectProfileForChat(profile: ProfileDto): Promise<void> {
        if (this.startingDirectChat) {
            return;
        }

        const myProfile = this.session.profile;
        const isCurrentUser = (myProfile?.id && profile.id === myProfile.id)
            || (!!myProfile?.handle && profile.handle.toLowerCase() === myProfile.handle.toLowerCase());
        if (isCurrentUser) {
            return;
        }

        this.closeChatSearchModal(true);
        await this.startDirectChat(profile.id);
    }

    async startDirectChat(profileId: string): Promise<void> {
        if (this.startingDirectChat) {
            return;
        }

        this.startingDirectChat = true;
        this.status = '';

        try {
            const conversation = await this.session.createDirectConversationAsync(profileId);
            const existingIndex = this.conversations.findIndex(x => x.id === conversation.id);
            if (existingIndex >= 0) {
                const next = [...this.conversations];
                next[existingIndex] = conversation;
                this.conversations = next;
            } else {
                this.conversations = [conversation, ...this.conversations];
            }

            await this.selectConversation(conversation);
        } catch {
            this.status = 'Could not start direct chat.';
        } finally {
            this.startingDirectChat = false;
        }
    }

    async selectConversation(conversation: ChatConversationDto): Promise<void> {
        const previousConversationId = this.selectedConversationId;
        this.selectedConversationId = conversation.id;
        this.selectedConversation = conversation;
        this.messages = [];
        this.messageSearchQuery = '';
        this.newMessage = '';
        this.loadingMessages = true;
        this.status = '';

        const realtimeSyncTask = this.syncRealtimeMembership(previousConversationId, conversation.id);

        try {
            const loadedMessages = await this.withTimeout(this.session.loadChatMessagesAsync(conversation.id), 5000);
            this.ngZone.run(() => {
                this.messages = loadedMessages;
            });
        } catch {
            this.ngZone.run(() => {
                this.messages = [];
                this.status = 'Could not load messages.';
            });
        } finally {
            this.ngZone.run(() => {
                this.loadingMessages = false;
                if (this.messages.length) {
                    this.scrollToBottomOnNextRender();
                }
            });
        }

        void realtimeSyncTask.then((realtimeUnavailable) => {
            if (!realtimeUnavailable || this.selectedConversationId !== conversation.id) {
                return;
            }

            this.ngZone.run(() => {
                if (!this.status) {
                    this.status = 'Live updates are temporarily unavailable.';
                }
            });
        });
    }

    async sendMessage(): Promise<void> {
        const conversationId = this.selectedConversationId;
        const content = this.composeOutgoingMessage();
        if (!conversationId || !content || this.sendingMessage) {
            return;
        }

        this.sendingMessage = true;
        this.status = '';

        try {
            const created = await this.session.sendChatMessageAsync(conversationId, content);
            this.upsertMessage(created);
            this.applyConversationPreview(created);
            this.newMessage = '';
            this.gifUrlInput = '';
            this.imageUrlInput = null;
            this.sharedPostInput = null;
            this.gifInputOpen = false;
            this.emojiPickerOpen = false;
            this.resetComposerHeight();
        } catch {
            this.status = 'Could not send message.';
        } finally {
            this.sendingMessage = false;
        }
    }

    onComposerInputChange(): void {
        this.adjustComposerHeight();
    }

    onComposerKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }

        event.preventDefault();
        void this.sendMessage();
    }

    async sendSuggestedMessage(content: string): Promise<void> {
        if (this.sendingMessage || this.loadingMessages) {
            return;
        }

        this.newMessage = content;
        await this.sendMessage();
    }

    appendEmoji(emoji: string): void {
        this.newMessage = `${this.newMessage}${emoji}`;
        this.adjustComposerHeight();
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

            const results = this.mapGiphyResults(payload.data);

            this.ngZone.run(() => {
                this.gifResults = results;
            });
        } catch {
            this.ngZone.run(() => {
                this.status = 'Could not load GIFs from Giphy.';
                this.gifResults = [];
            });
        } finally {
            this.ngZone.run(() => {
                this.searchingGifs = false;
            });
        }
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

            const results = this.mapGiphyResults(payload.data);
            this.ngZone.run(() => {
                this.gifResults = results;
            });
        } catch {
            this.ngZone.run(() => {
                this.status = 'Could not load trending GIFs.';
                this.gifResults = [];
            });
        } finally {
            this.ngZone.run(() => {
                this.searchingGifs = false;
            });
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

    async selectGif(gif: GiphyGifResult): Promise<void> {
        const conversationId = this.selectedConversationId;
        if (!conversationId || this.sendingMessage || this.loadingMessages) {
            return;
        }

        this.gifInputOpen = false;
        this.gifSearchQuery = '';
        this.gifResults = [];

        this.sendingMessage = true;
        this.status = '';

        try {
            const created = await this.session.sendChatMessageAsync(conversationId, `[gif]${gif.originalUrl}`);
            this.upsertMessage(created);
            this.applyConversationPreview(created);
        } catch {
            this.status = 'Could not send GIF.';
        } finally {
            this.sendingMessage = false;
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
            if (!this.sendingMessage && this.selectedConversationId) {
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

    parsedMessage(message: ChatMessageDto): ParsedChatMessage {
        return this.parseMessageContent(message.content);
    }

    hasComposerMedia(): boolean {
        return !!this.imageUrlInput || !!this.normalizedMediaUrl(this.gifUrlInput) || !!this.sharedPostInput;
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

    composerSharedPost(): SharedPostPreview | null {
        return this.sharedPostInput;
    }

    clearComposerSharedPost(): void {
        this.sharedPostInput = null;
    }

    conversationPreview(content: string): string {
        const parsed = this.parseMessageContent(content);
        const text = parsed.text.trim();

        if (text && parsed.imageUrl) {
            return `${text} · 📷 Image`;
        }

        if (text && parsed.gifUrl) {
            return `${text} · GIF`;
        }

        if (parsed.gifUrl) {
            return 'GIF';
        }

        if (parsed.imageUrl) {
            return '📷 Image';
        }

        if (parsed.sharedPost) {
            return `Shared post from @${parsed.sharedPost.authorHandle}`;
        }

        return text;
    }

    async setMessageReaction(message: ChatMessageDto, reactionType: string): Promise<void> {
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

    async clearMessageReaction(message: ChatMessageDto): Promise<void> {
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

    participantNames(conversation: ChatConversationDto): string {
        const currentProfileId = this.currentProfileId;
        const others = conversation.participants.filter(x => x.profileId !== currentProfileId);
        return others.map(x => x.displayName).join(', ') || 'Me';
    }

    conversationTitle(conversation: ChatConversationDto): string {
        if (conversation.title?.trim()) {
            return conversation.title;
        }

        return conversation.isGroup
            ? this.participantNames(conversation)
            : this.participantNames(conversation);
    }

    conversationAvatarText(conversation: ChatConversationDto): string {
        const title = this.conversationTitle(conversation).trim();
        return title ? title[0].toUpperCase() : 'C';
    }

    conversationAvatarUrl(conversation: ChatConversationDto): string | undefined {
        return this.primaryParticipant(conversation)?.imageUrl;
    }

    chatHeaderName(conversation: ChatConversationDto): string {
        if (conversation.title?.trim()) {
            return conversation.title;
        }

        return this.primaryParticipant(conversation)?.displayName ?? this.participantNames(conversation);
    }

    chatHeaderHandle(conversation: ChatConversationDto): string {
        const participant = this.primaryParticipant(conversation);
        if (participant?.handle) {
            return `@${participant.handle}`;
        }

        return this.participantNames(conversation);
    }

    chatHeaderProfileHandle(conversation: ChatConversationDto): string | null {
        return this.primaryParticipant(conversation)?.handle ?? null;
    }

    openUserProfile(handle: string, event: MouseEvent): void {
        event.preventDefault();
        void this.router.navigate(['/users', handle]);
    }

    openHashtag(tag: string, event: MouseEvent): void {
        event.preventDefault();
        void this.router.navigate(['/hashtags', tag]);
    }

    richTextLines(content: string): RichTextPart[][] {
        return (content ?? '')
            .split(/\r?\n/)
            .map(line => this.parseRichLineParts(line));
    }

    sharedPreviewContent(content: string): string {
        const source = (content ?? '').trim();
        if (!source) {
            return '';
        }

        const lines = source.split(/\r?\n/);
        const clippedLines = lines.slice(0, this.sharedPreviewMaxLines);
        let clipped = clippedLines.join('\n');

        if (clipped.length > this.sharedPreviewMaxChars) {
            clipped = clipped.slice(0, this.sharedPreviewMaxChars).trimEnd();
        }

        const truncated = clipped.length < source.length || lines.length > this.sharedPreviewMaxLines;
        if (truncated) {
            return `${clipped}…`;
        }

        return clipped;
    }

    isSharedPreviewTruncated(content: string): boolean {
        const source = (content ?? '').trim();
        if (!source) {
            return false;
        }

        const lines = source.split(/\r?\n/);
        if (lines.length > this.sharedPreviewMaxLines) {
            return true;
        }

        const clipped = lines.slice(0, this.sharedPreviewMaxLines).join('\n');
        return clipped.length > this.sharedPreviewMaxChars;
    }

    openSharedPost(shared: SharedPostPreview, event: MouseEvent): void {
        event.preventDefault();
        void this.router.navigate(['/users', shared.authorHandle], { fragment: `post-${shared.postId}` });
    }

    formatTime(dateValueUtc: string): string {
        const date = new Date(dateValueUtc);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);
    }

    shouldShowMessageTimeBreak(index: number): boolean {
        const visible = this.visibleMessages;
        if (index < 0 || index >= visible.length) {
            return false;
        }

        if (index === 0) {
            return true;
        }

        const currentAt = Date.parse(visible[index].createdAtUtc);
        const previousAt = Date.parse(visible[index - 1].createdAtUtc);
        if (Number.isNaN(currentAt) || Number.isNaN(previousAt)) {
            return true;
        }

        return currentAt - previousAt >= this.messageGapForTimeBreakMs;
    }

    isCompactMessage(index: number): boolean {
        const visible = this.visibleMessages;
        if (index <= 0 || index >= visible.length) {
            return false;
        }

        const current = visible[index];
        const previous = visible[index - 1];
        if (current.authorProfileId !== previous.authorProfileId) {
            return false;
        }

        const currentAt = Date.parse(current.createdAtUtc);
        const previousAt = Date.parse(previous.createdAtUtc);
        if (Number.isNaN(currentAt) || Number.isNaN(previousAt)) {
            return false;
        }

        return currentAt - previousAt < this.messageGapForCompactMs;
    }

    isLinkedTextToNextShared(index: number): boolean {
        const visible = this.visibleMessages;
        if (index < 0 || index >= visible.length - 1) {
            return false;
        }

        const current = visible[index];
        const next = visible[index + 1];
        if (current.authorProfileId !== next.authorProfileId) {
            return false;
        }

        if (!this.isCompactMessage(index + 1)) {
            return false;
        }

        const currentParsed = this.parseMessageContent(current.content);
        const nextParsed = this.parseMessageContent(next.content);
        return this.isTextOnlyMessage(currentParsed) && this.isSharedOnlyMessage(nextParsed);
    }

    isLinkedSharedFromPreviousText(index: number): boolean {
        const visible = this.visibleMessages;
        if (index <= 0 || index >= visible.length) {
            return false;
        }

        return this.isLinkedTextToNextShared(index - 1);
    }

    formatMessageBreak(dateValueUtc: string): string {
        const date = new Date(dateValueUtc);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);
    }

    messageAuthorLabel(message: ChatMessageDto): string {
        return this.currentProfileId === message.authorProfileId ? 'You' : `@${message.authorHandle}`;
    }

    messageAvatarUrl(message: ChatMessageDto): string | undefined {
        if (this.currentProfileId === message.authorProfileId) {
            return this.session.profile?.imageUrl;
        }

        return message.authorImageUrl;
    }

    messageAvatarText(message: ChatMessageDto): string {
        if (this.currentProfileId === message.authorProfileId) {
            const profile = this.session.profile;
            const source = profile?.displayName?.trim() || profile?.handle?.trim() || message.authorHandle;
            return source ? source[0].toUpperCase() : 'U';
        }

        const handle = message.authorHandle.trim();
        return handle ? handle[0].toUpperCase() : 'U';
    }

    reactionEmoji(type: string): string {
        return this.reactionOptions.find(x => x.type === type)?.emoji ?? '👍';
    }

    trackByConversationId(_: number, conversation: ChatConversationDto): string {
        return conversation.id;
    }

    trackByMessageId(_: number, message: ChatMessageDto): string {
        return message.id;
    }

    private applyMessageUpdate(updated: ChatMessageDto): void {
        this.upsertMessage(updated);
    }

    private upsertMessage(updated: ChatMessageDto): void {
        if (this.selectedConversationId !== updated.conversationId) {
            return;
        }

        const index = this.messages.findIndex(x => x.id === updated.id);
        if (index < 0) {
            this.messages = [...this.messages, updated]
                .sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
            this.scrollToBottomOnNextRender();
            return;
        }

        const next = [...this.messages];
        next[index] = updated;
        this.messages = next;
    }

    private scrollToBottomOnNextRender(): void {
        const maxAttempts = 12;

        const scrollToBottom = (attemptsLeft: number, previousHeight = -1) => {
            const container = this.messageListRef?.nativeElement;
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

    private applyConversationPreview(message: ChatMessageDto): void {
        const authorHandle = this.currentProfileId === message.authorProfileId
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
                        content: this.conversationPreview(message.content),
                        createdAtUtc: message.createdAtUtc
                    }
                };
            })
            .sort((left, right) => {
                const leftAt = left.lastMessage?.createdAtUtc ?? left.createdAtUtc;
                const rightAt = right.lastMessage?.createdAtUtc ?? right.createdAtUtc;
                return rightAt.localeCompare(leftAt);
            });

        if (this.selectedConversationId === message.conversationId) {
            const selected = this.conversations.find(x => x.id === message.conversationId) ?? null;
            this.selectedConversation = selected;
        }
    }

    private withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = window.setTimeout(() => reject(new Error('Operation timed out.')), timeoutMs);

            operation
                .then(result => {
                    window.clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    window.clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    private async syncRealtimeMembership(previousConversationId: string | null, nextConversationId: string): Promise<boolean> {
        let realtimeUnavailable = false;

        if (previousConversationId && previousConversationId !== nextConversationId) {
            try {
                await this.withTimeout(this.chatRealtime.leaveConversation(previousConversationId), 1800);
            } catch {
                realtimeUnavailable = true;
            }
        }

        try {
            await this.withTimeout(this.chatRealtime.joinConversation(nextConversationId), 1800);
        } catch {
            realtimeUnavailable = true;
        }

        return realtimeUnavailable;
    }

    private primaryParticipant(conversation: ChatConversationDto): ChatParticipantDto | undefined {
        const currentProfileId = this.currentProfileId;
        return conversation.participants.find(x => x.profileId !== currentProfileId) ?? conversation.participants[0];
    }

    private composeOutgoingMessage(): string {
        const text = this.newMessage.trim();
        const gifUrl = this.composerGifUrl();
        const imageUrl = this.composerImageUrl();
        const sharedPost = this.sharedPostInput;

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

        if (sharedPost) {
            parts.push(buildSharedPostMarker(sharedPost));
        }

        return parts.join('\n').trim();
    }

    private parseMessageContent(content: string): ParsedChatMessage {
        const lines = content.split(/\r?\n/);
        const textLines: string[] = [];
        let imageUrl: string | undefined;
        let gifUrl: string | undefined;
        let sharedPost: SharedPostPreview | undefined;

        for (const rawLine of lines) {
            const line = rawLine.trim();

            if (line.startsWith('[image]')) {
                const url = this.normalizedMediaUrl(line.slice(7));
                if (url) {
                    imageUrl = url;
                }
                continue;
            }

            if (line.startsWith('[gif]')) {
                const url = this.normalizedMediaUrl(line.slice(5));
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

        const text = textLines.join('\n').trim();

        if (!imageUrl && !gifUrl) {
            const normalized = this.normalizedMediaUrl(text);
            if (normalized) {
                if (this.isGifUrl(normalized)) {
                    gifUrl = normalized;
                } else if (this.isImageUrl(normalized)) {
                    imageUrl = normalized;
                }
            }
        }

        return {
            text: imageUrl || gifUrl ? (text === imageUrl || text === gifUrl ? '' : text) : text,
            imageUrl,
            gifUrl,
            sharedPost
        };
    }

    private parseRichLineParts(line: string): RichTextPart[] {
        const tokenRegex = /#[\p{L}\p{N}_]+|\B@[\p{L}\p{N}_]+/gu;
        const parts: RichTextPart[] = [];
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

    private isTextOnlyMessage(parsed: ParsedChatMessage): boolean {
        return !!parsed.text && !parsed.imageUrl && !parsed.gifUrl && !parsed.sharedPost;
    }

    private isSharedOnlyMessage(parsed: ParsedChatMessage): boolean {
        return !!parsed.sharedPost && !parsed.text && !parsed.imageUrl && !parsed.gifUrl;
    }

    private messageSearchIndex(content: string): string {
        const parsed = this.parseMessageContent(content);
        return [parsed.text, parsed.imageUrl ?? '', parsed.gifUrl ?? '', parsed.sharedPost?.authorHandle ?? '', parsed.sharedPost?.content ?? ''].join(' ').toLowerCase();
    }

    private adjustComposerHeight(): void {
        const composer = this.composerInputRef?.nativeElement;
        if (!composer) {
            return;
        }

        composer.style.height = `${this.composerMinHeightPx}px`;
        const nextHeight = Math.min(Math.max(composer.scrollHeight, this.composerMinHeightPx), this.composerMaxHeightPx);
        composer.style.height = `${nextHeight}px`;
        composer.style.overflowY = nextHeight >= this.composerMaxHeightPx ? 'auto' : 'hidden';
    }

    private resetComposerHeight(): void {
        const composer = this.composerInputRef?.nativeElement;
        if (!composer) {
            return;
        }

        composer.style.height = `${this.composerMinHeightPx}px`;
        composer.style.overflowY = 'hidden';
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

    private isImageUrl(url: string): boolean {
        return /\.(png|jpe?g|webp|bmp|svg|gif)($|\?)/i.test(url);
    }

    private scheduleProfileSearch(query: string): void {
        if (this.searchProfilesDebounceId !== null) {
            window.clearTimeout(this.searchProfilesDebounceId);
            this.searchProfilesDebounceId = null;
        }

        this.searchingProfiles = true;
        this.searchProfilesDebounceId = window.setTimeout(() => {
            this.searchProfilesDebounceId = null;
            void this.searchProfiles(query);
        }, 250);
    }

    private async searchProfiles(query: string): Promise<void> {
        const currentQuery = query.trim();
        if (!currentQuery) {
            this.searchingProfiles = false;
            this.filteredProfiles = [];
            return;
        }

        try {
            const profiles = await this.session.searchProfilesAsync(currentQuery);
            if (this.modalSearchUsersQuery.trim() !== currentQuery) {
                return;
            }

            const myProfile = this.session.profile;
            const myId = myProfile?.id ?? null;
            const myHandle = myProfile?.handle?.toLowerCase() ?? null;

            this.filteredProfiles = profiles.filter(profile => {
                if (myId && profile.id === myId) {
                    return false;
                }

                if (myHandle && profile.handle.toLowerCase() === myHandle) {
                    return false;
                }

                return true;
            });
            this.searchUsersError = '';
        } catch {
            if (this.modalSearchUsersQuery.trim() !== currentQuery) {
                return;
            }

            this.filteredProfiles = [];
            this.searchUsersError = 'Could not search users right now.';
        } finally {
            if (this.modalSearchUsersQuery.trim() === currentQuery) {
                this.searchingProfiles = false;
            }
        }
    }

    private async loadProfileSuggestions(): Promise<void> {
        if (!this.chatSearchModalOpen) {
            return;
        }

        this.loadingProfileSuggestions = true;

        try {
            const suggestions = await this.session.loadFollowSuggestionsAsync(10);
            if (!this.chatSearchModalOpen || this.modalSearchUsersQuery.trim()) {
                return;
            }

            this.suggestedFollowingProfiles = suggestions.following;
            this.suggestedRelevantProfiles = suggestions.relevant;
            this.searchUsersError = '';
        } catch {
            if (!this.chatSearchModalOpen || this.modalSearchUsersQuery.trim()) {
                return;
            }

            this.suggestedFollowingProfiles = [];
            this.suggestedRelevantProfiles = [];
            this.searchUsersError = 'Could not load suggestions right now.';
        } finally {
            if (this.chatSearchModalOpen && !this.modalSearchUsersQuery.trim()) {
                this.loadingProfileSuggestions = false;
            }
        }
    }
}
