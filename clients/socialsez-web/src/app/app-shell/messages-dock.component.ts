import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ChatConversationDto, ChatMessageDto, ChatParticipantDto, ProfileDto } from '../core/api.types';
import { SharedReelCommentPreview, SharedReelPreview, decodeSharedReelPayload } from '../core/shared-reel.utils';
import { SharedPostPreview, decodeSharedPostPayload } from '../core/shared-post.utils';
import { SharedStoryPreview, decodeSharedStoryPayload } from '../core/shared-story.utils';
import { SessionService } from '../core/session.service';
import { ReactionPickerComponent } from '../shared/reaction-picker/reaction-picker.component';
import { SkeletonComponent } from '../shared/skeleton/skeleton.component';
import { environment } from '../../environments/environment';
import 'emoji-picker-element';

interface ParsedDockMessage {
    text: string;
    imageUrl?: string;
    gifUrl?: string;
    sharedPost?: SharedPostPreview;
    sharedReel?: SharedReelPreview;
    sharedStory?: SharedStoryPreview;
    unfurlUrl?: string;
}

interface DockUnfurlPreview {
    unfurlUrl: string;
    targetUrl: string;
    title: string;
    description: string;
    imageUrl?: string;
}

interface DockMediaRequest {
    kind: 'story' | 'reel';
    mediaUrl: string;
    authorHandle: string;
    authorImageUrl?: string;
    authorProfileId?: string;
    reelId?: string;
    caption?: string;
    createdAtUtc?: string;
    likeCount?: number;
    likedByMe?: boolean;
    comments?: SharedReelCommentPreview[];
    thumbnailUrl?: string;
}

interface GiphyGifResult {
    id: string;
    title: string;
    previewUrl: string;
    originalUrl: string;
}

interface DockRecentContactAvatar {
    key: string;
    imageUrl: string;
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
    @Output() sharedMediaRequested = new EventEmitter<DockMediaRequest>();
    readonly avatarFallbackUrl = '/assets/images/avatar-fallback.svg';
    private static readonly UnfurlPrefix = '/api/unfurl/';
    private readonly apiOrigin = this.resolveApiOrigin();
    private readonly messageGapForTimeBreakMs = 30 * 60 * 1000;
    private readonly messageGapForCompactMs = 5 * 60 * 1000;
    private readonly giphyApiKey = 'iY9dDrlVL8teP0Csu3Y1Fcq3AbyCPPmg';
    private readonly sharedPreviewMaxChars = 220;
    readonly noReactions: ReadonlyArray<{ type: string; count: number }> = [];
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
    private readonly dockStartedConversationIds = new Set<string>();

    get filteredConversations(): ChatConversationDto[] {
        const visibleConversations = this.conversations.filter(
            (conversation) => !!conversation.lastMessage || this.dockStartedConversationIds.has(conversation.id)
        );

        if (!this.searchConversationsQuery.trim()) {
            return visibleConversations;
        }

        const query = this.searchConversationsQuery.trim().toLowerCase();
        return visibleConversations.filter(
            (conv) =>
                this.displayName(conv).toLowerCase().includes(query) ||
                this.preview(conv).toLowerCase().includes(query)
        );
    }

    get recentMessagedAvatars(): ReadonlyArray<DockRecentContactAvatar> {
        const avatars: DockRecentContactAvatar[] = [];
        const seenKeys = new Set<string>();

        for (const conversation of this.conversations) {
            if (!conversation.lastMessage) {
                continue;
            }

            const participant = this.primaryParticipant(conversation);
            const key = participant?.profileId?.trim() || conversation.id;
            if (seenKeys.has(key)) {
                continue;
            }

            seenKeys.add(key);
            avatars.push({
                key,
                imageUrl: participant?.imageUrl?.trim() || this.avatarFallbackUrl
            });

            if (avatars.length >= 3) {
                break;
            }
        }

        return avatars;
    }

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
    searchConversationsQuery = '';
    gifResults: GiphyGifResult[] = [];
    searchingGifs = false;
    imageUrlInput: string | null = null;
    gifUrlInput = '';
    emojiPickerOpen = false;
    gifInputOpen = false;
    newChatSearchOpen = false;
    newChatSearchQuery = '';
    newChatSearchingProfiles = false;
    newChatLoadingProfileSuggestions = false;
    newChatError = '';
    newChatFilteredProfiles: ProfileDto[] = [];
    newChatSuggestedFollowingProfiles: ProfileDto[] = [];
    newChatSuggestedRelevantProfiles: ProfileDto[] = [];
    loadingSharedReelDetails = false;
    private readonly unavailableSharedReelKeys = new Set<string>();
    private readonly unfurlPreviewByUrl = new Map<string, DockUnfurlPreview>();
    private readonly pendingUnfurlPreviewUrls = new Set<string>();
    private newChatSearchProfilesDebounceId: number | null = null;

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

    ngOnChanges(changes: SimpleChanges): void {
        if (!changes['visible']) {
            return;
        }

        if (this.visible) {
            void this.ensureRecentConversationsLoaded();
        }
    }

    toggle(event?: Event): void {
        event?.stopPropagation();
        if (!this.visible) {
            return;
        }

        if (this.open) {
            this.close(event);
            return;
        }

        this.open = true;
        if (this.open) {
            void this.loadConversations();
        }
    }

    close(event?: Event): void {
        event?.stopPropagation();
        this.open = false;
        this.resetDockState();
    }

    private resetDockState(): void {
        this.activeConversation = null;
        this.messages = [];
        this.loading = false;
        this.loadingMessages = false;
        this.sendingMessage = false;
        this.uploadingImage = false;
        this.reactingMessageId = null;
        this.loadingSharedReelDetails = false;
        this.unavailableSharedReelKeys.clear();
        this.draftMessage = '';
        this.searchConversationsQuery = '';
        this.imageUrlInput = null;
        this.gifUrlInput = '';
        this.gifSearchQuery = '';
        this.gifResults = [];
        this.searchingGifs = false;
        this.gifInputOpen = false;
        this.emojiPickerOpen = false;
        this.newChatSearchOpen = false;
        this.newChatSearchQuery = '';
        this.newChatSearchingProfiles = false;
        this.newChatLoadingProfileSuggestions = false;
        this.newChatError = '';
        this.newChatFilteredProfiles = [];
        this.newChatSuggestedFollowingProfiles = [];
        this.newChatSuggestedRelevantProfiles = [];
        if (this.newChatSearchProfilesDebounceId !== null) {
            window.clearTimeout(this.newChatSearchProfilesDebounceId);
            this.newChatSearchProfilesDebounceId = null;
        }
        this.status = '';
    }

    private async ensureRecentConversationsLoaded(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.conversations = [];
            return;
        }

        if (this.conversations.length || this.loading) {
            return;
        }

        await this.loadConversations();
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
            void this.prefetchUnavailableSharedReelsFromMessages(loaded);
            void this.prefetchUnfurlPreviewsFromMessages(loaded, true);
        } catch {
            this.messages = [];
            this.status = 'Could not load messages.';
        } finally {
            this.loadingMessages = false;
            if (this.messages.length && !this.status) {
                this.scrollThreadToBottomOnNextRender();
                window.setTimeout(() => this.scrollThreadToBottomOnNextRender(), 350);
            }
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

    messageAvatarUrl(message: ChatMessageDto): string | undefined {
        if (this.isOwnMessage(message)) {
            return this.session.profile?.imageUrl?.trim() || undefined;
        }

        const directImage = message.authorImageUrl?.trim();
        if (directImage) {
            return directImage;
        }

        const participantImage = this.activeConversation?.participants
            .find(participant => participant.profileId === message.authorProfileId)
            ?.imageUrl
            ?.trim();

        return participantImage || undefined;
    }

    messageAvatarText(message: ChatMessageDto): string {
        if (this.isOwnMessage(message)) {
            const source = this.session.profile?.displayName?.trim()
                || this.session.profile?.handle?.trim()
                || message.authorHandle?.trim();
            return source ? source[0].toUpperCase() : 'U';
        }

        const source = message.authorHandle?.trim()
            || this.activeConversation?.participants
                .find(participant => participant.profileId === message.authorProfileId)
                ?.displayName
                ?.trim();

        return source ? source[0].toUpperCase() : 'U';
    }

    shouldShowMessageTimeBreak(index: number): boolean {
        if (index < 0 || index >= this.messages.length) {
            return false;
        }

        if (index === 0) {
            return true;
        }

        const currentAt = Date.parse(this.messages[index].createdAtUtc);
        const previousAt = Date.parse(this.messages[index - 1].createdAtUtc);
        if (Number.isNaN(currentAt) || Number.isNaN(previousAt)) {
            return true;
        }

        return currentAt - previousAt >= this.messageGapForTimeBreakMs;
    }

    isCompactMessage(index: number): boolean {
        if (index <= 0 || index >= this.messages.length) {
            return false;
        }

        const current = this.messages[index];
        const previous = this.messages[index - 1];
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

    parsedMessage(content: string): ParsedDockMessage {
        const lines = (content ?? '').split(/\r?\n/);
        const textLines: string[] = [];
        let imageUrl: string | undefined;
        let gifUrl: string | undefined;
        let sharedPost: SharedPostPreview | undefined;
        let sharedReel: SharedReelPreview | undefined;
        let sharedStory: SharedStoryPreview | undefined;
        let unfurlUrl: string | undefined;

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

            if (line.startsWith('[reel]')) {
                const parsed = decodeSharedReelPayload(line.slice(6));
                if (parsed) {
                    sharedReel = parsed;
                    continue;
                }
            }

            if (line.startsWith('[story]')) {
                const parsed = decodeSharedStoryPayload(line.slice(7));
                if (parsed) {
                    const mediaUrl = this.normalizedMediaUrl(parsed.mediaUrl) ?? parsed.mediaUrl;
                    const thumbnailUrl = parsed.thumbnailUrl
                        ? this.normalizedMediaUrl(parsed.thumbnailUrl) ?? parsed.thumbnailUrl
                        : undefined;

                    sharedStory = {
                        ...parsed,
                        mediaUrl,
                        thumbnailUrl
                    };
                    continue;
                }
            }

            textLines.push(rawLine);
        }

        let text = textLines.join('\n').trim();

        if (!sharedStory && !sharedReel && !imageUrl && !gifUrl) {
            const storyLeadPattern = /^🔗\s*Story\s+from\s+@([\w.]+)\s*$/i;
            const storyLeadLine = lines.map(line => line.trim()).find(line => storyLeadPattern.test(line));

            if (storyLeadLine) {
                const storyMatch = storyLeadLine.match(storyLeadPattern);
                const authorHandle = storyMatch?.[1]?.trim();
                const storyMediaUrl = lines
                    .map(line => this.normalizedMediaUrl(line))
                    .find((url): url is string => !!url);

                if (authorHandle && storyMediaUrl) {
                    sharedStory = {
                        authorHandle,
                        mediaUrl: storyMediaUrl,
                        thumbnailUrl: this.isImageUrl(storyMediaUrl) ? storyMediaUrl : undefined
                    };

                    const cleanedLines = textLines
                        .map(line => line.trim())
                        .filter(line => !!line)
                        .filter(line => !storyLeadPattern.test(line))
                        .filter(line => this.normalizedMediaUrl(line) !== storyMediaUrl);
                    text = cleanedLines.join('\n').trim();
                }
            }
        }

        if (!imageUrl && !gifUrl && !sharedReel) {
            const normalized = this.normalizedMediaUrl(text);
            if (normalized) {
                if (this.isGifUrl(normalized)) {
                    gifUrl = normalized;
                } else if (this.isImageUrl(normalized)) {
                    imageUrl = normalized;
                } else if (this.isVideoUrl(normalized)) {
                    sharedReel = {
                        videoUrl: normalized
                    };
                } else if (this.isUnfurlUrl(normalized)) {
                    unfurlUrl = normalized;
                }
            }
        }

        if (!unfurlUrl && !sharedStory && !sharedReel && !imageUrl && !gifUrl) {
            const inlineUnfurlUrl = this.extractUnfurlUrlFromText(text);
            if (inlineUnfurlUrl) {
                unfurlUrl = inlineUnfurlUrl;
            }
        }

        if (unfurlUrl && text === unfurlUrl) {
            text = '';
        }

        return {
            text,
            imageUrl,
            gifUrl,
            sharedPost,
            sharedReel,
            sharedStory,
            unfurlUrl
        };
    }

    messageVariant(content: string): 'default' | 'shared-only' | 'media-only' {
        const parsed = this.parsedMessage(content);
        if ((parsed.sharedPost || parsed.sharedReel || parsed.sharedStory || parsed.unfurlUrl) && !parsed.text && !parsed.imageUrl && !parsed.gifUrl) {
            return 'shared-only';
        }

        if (!parsed.text && !parsed.sharedPost && !parsed.sharedReel && !parsed.sharedStory && !parsed.unfurlUrl && (!!parsed.imageUrl || !!parsed.gifUrl)) {
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
        const normalizedType = this.normalizeReactionType(type);
        if (!normalizedType) {
            return this.reactionOptions[0]?.emoji ?? '👍';
        }

        return this.reactionOptions.find(option => option.type === normalizedType)?.emoji ?? this.reactionOptions[0]?.emoji ?? '👍';
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
            default:
                return 'fa-duotone fa-solid fa-thumbs-up';
        }
    }

    reactionBadgeClass(type: string): string {
        const normalizedType = this.normalizeReactionType(type) ?? 'Like';
        return `type-${normalizedType.toLowerCase()}`;
    }

    messageDisplayReactions(message: ChatMessageDto): ReadonlyArray<{ type: string; count: number }> {
        const counts = new Map<string, number>();

        for (const reaction of message.reactions) {
            const normalizedType = this.normalizeReactionType(reaction.type);
            if (!normalizedType) {
                continue;
            }

            const count = Math.max(0, reaction.count ?? 0);
            if (!count) {
                continue;
            }

            counts.set(normalizedType, (counts.get(normalizedType) ?? 0) + count);
        }

        return this.reactionOptions
            .filter(option => counts.has(option.type))
            .map(option => ({
                type: option.type,
                count: counts.get(option.type) ?? 0
            }));
    }

    private normalizeReactionType(type: string): string | null {
        const normalized = (type ?? '').trim();
        if (!normalized) {
            return null;
        }

        const option = this.reactionOptions.find(item => item.type.toLowerCase() === normalized.toLowerCase());
        if (option) {
            return option.type;
        }

        if (normalized.toLowerCase() === 'party') {
            return 'PartyHorn';
        }

        return null;
    }

    isImageMedia(url: string): boolean {
        return this.isImageUrl(url);
    }

    isVideoMedia(url: string): boolean {
        return this.isVideoUrl(url);
    }

    async onMessagePrimaryReaction(message: ChatMessageDto): Promise<void> {
        if (message.myReactionType) {
            await this.clearMessageReaction(message);
            return;
        }

        await this.setMessageReaction(message, 'Love');
    }

    async onMessageReactionSelected(message: ChatMessageDto, reactionType: string): Promise<void> {
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
        void this.router.navigate(['/post', shared.postId]);
    }

    openSharedStory(sharedStory: SharedStoryPreview, message: ChatMessageDto, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        const mediaUrl = this.normalizedMediaUrl(sharedStory.mediaUrl);
        if (!mediaUrl) {
            this.status = 'Could not open this story.';
            return;
        }

        this.sharedMediaRequested.emit({
            kind: 'story',
            mediaUrl,
            authorHandle: sharedStory.authorHandle?.trim() || message.authorHandle || 'story',
            authorImageUrl: message.authorImageUrl,
            authorProfileId: message.authorProfileId,
            createdAtUtc: message.createdAtUtc
        });
    }

    async openSharedReel(sharedReel: SharedReelPreview, message: ChatMessageDto, event: Event): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        this.status = '';

        if (this.isSharedReelUnavailable(sharedReel)) {
            return;
        }

        let resolvedPreview: SharedReelPreview = {
            ...sharedReel,
            authorHandle: sharedReel.authorHandle?.trim() || message.authorHandle,
            authorImageUrl: sharedReel.authorImageUrl || message.authorImageUrl,
            createdAtUtc: sharedReel.createdAtUtc || message.createdAtUtc
        };

        if (resolvedPreview.reelId) {
            this.loadingSharedReelDetails = true;
            try {
                const reel = await this.session.loadPublicReelByIdAsync(resolvedPreview.reelId);
                if (!reel) {
                    this.markSharedReelUnavailable(resolvedPreview);
                    return;
                }

                resolvedPreview = {
                    ...resolvedPreview,
                    videoUrl: reel.videoUrl || resolvedPreview.videoUrl,
                    thumbnailUrl: reel.thumbnailUrl || resolvedPreview.thumbnailUrl,
                    caption: reel.caption || resolvedPreview.caption,
                    authorHandle: reel.authorHandle || resolvedPreview.authorHandle,
                    authorImageUrl: reel.authorImageUrl || resolvedPreview.authorImageUrl
                };
            } catch {
                this.status = 'Could not open this reel.';
                return;
            } finally {
                this.loadingSharedReelDetails = false;
            }
        }

        const mediaUrl = this.normalizedMediaUrl(resolvedPreview.videoUrl);
        if (!mediaUrl) {
            this.status = 'Could not open this reel.';
            return;
        }

        this.sharedMediaRequested.emit({
            kind: 'reel',
            mediaUrl,
            authorHandle: resolvedPreview.authorHandle?.trim() || message.authorHandle || 'shared reel',
            authorImageUrl: resolvedPreview.authorImageUrl || message.authorImageUrl,
            authorProfileId: message.authorProfileId,
            reelId: resolvedPreview.reelId,
            caption: resolvedPreview.caption,
            createdAtUtc: resolvedPreview.createdAtUtc,
            likeCount: resolvedPreview.likeCount,
            likedByMe: resolvedPreview.likedByMe,
            comments: resolvedPreview.comments,
            thumbnailUrl: resolvedPreview.thumbnailUrl
        });
    }

    isSharedReelUnavailable(sharedReel: SharedReelPreview): boolean {
        return this.unavailableSharedReelKeys.has(this.sharedReelKey(sharedReel));
    }

    trackByConversationId(_: number, conversation: ChatConversationDto): string {
        return conversation.id;
    }

    trackByRecentAvatar(_: number, avatar: DockRecentContactAvatar): string {
        return avatar.key;
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

    avatarText(source: ChatConversationDto | ProfileDto): string {
        if ('lastMessage' in source) {
            // It's a ChatConversationDto
            const conversation = source as ChatConversationDto;
            const title = this.displayName(conversation).trim();
            return title ? title[0].toUpperCase() : 'C';
        } else {
            // It's a ProfileDto
            const profile = source as ProfileDto;
            const profileSource = profile.displayName?.trim() || profile.handle?.trim();
            return profileSource ? profileSource[0].toUpperCase() : 'U';
        }
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
            this.conversations = (await this.session.loadChatConversationsAsync())
                .sort((left, right) => this.conversationActivityAt(right).localeCompare(this.conversationActivityAt(left)));
        } catch {
            this.conversations = [];
            this.status = 'Could not load messages.';
        } finally {
            this.loading = false;
        }
    }

    private conversationActivityAt(conversation: ChatConversationDto): string {
        return conversation.lastMessage?.createdAtUtc ?? conversation.createdAtUtc;
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
            void this.prefetchUnavailableSharedReelsFromMessages([updated]);
            void this.prefetchUnfurlPreviewsFromMessages([updated]);
            return;
        }

        const next = [...this.messages];
        next[index] = updated;
        this.messages = next;
        void this.prefetchUnavailableSharedReelsFromMessages([updated]);
        void this.prefetchUnfurlPreviewsFromMessages([updated]);
    }

    getUnfurlPreview(unfurlUrl: string): DockUnfurlPreview | null {
        return this.unfurlPreviewByUrl.get(unfurlUrl) ?? null;
    }

    isUnfurlPreviewLoading(unfurlUrl: string): boolean {
        return this.pendingUnfurlPreviewUrls.has(unfurlUrl) && !this.unfurlPreviewByUrl.has(unfurlUrl);
    }

    openUnfurledLink(unfurlUrl: string, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        const preview = this.unfurlPreviewByUrl.get(unfurlUrl);
        const targetUrl = preview?.targetUrl ?? this.resolveTargetFromUnfurlUrl(unfurlUrl) ?? unfurlUrl;
        this.navigateToUrl(targetUrl);
    }

    private async prefetchUnavailableSharedReelsFromMessages(messages: ReadonlyArray<ChatMessageDto>): Promise<void> {
        const byKey = new Map<string, SharedReelPreview>();

        for (const message of messages) {
            const preview = this.parsedMessage(message.content).sharedReel;
            const reelId = preview?.reelId?.trim();
            if (!preview || !reelId || this.isSharedReelUnavailable(preview)) {
                continue;
            }

            const key = this.sharedReelKey(preview);
            if (!byKey.has(key)) {
                byKey.set(key, preview);
            }
        }

        if (!byKey.size) {
            return;
        }

        const checks = await Promise.allSettled(
            Array.from(byKey.values()).map(async preview => ({
                preview,
                reel: await this.session.loadPublicReelByIdAsync(preview.reelId!.trim())
            }))
        );

        for (const result of checks) {
            if (result.status === 'fulfilled' && !result.value.reel) {
                this.markSharedReelUnavailable(result.value.preview);
            }
        }
    }

    private async prefetchUnfurlPreviewsFromMessages(messages: ReadonlyArray<ChatMessageDto>, keepBottomOnComplete = false): Promise<void> {
        const unfurlUrls = new Set<string>();

        for (const message of messages) {
            const parsed = this.parsedMessage(message.content);
            if (parsed.unfurlUrl) {
                unfurlUrls.add(parsed.unfurlUrl);
            }
        }

        if (!unfurlUrls.size) {
            return;
        }

        await Promise.allSettled(
            Array.from(unfurlUrls).map(url => this.ensureUnfurlPreviewAsync(url))
        );

        if (keepBottomOnComplete && this.activeConversation?.id) {
            this.scrollThreadToBottomOnNextRender();
        }
    }

    private async ensureUnfurlPreviewAsync(unfurlUrl: string): Promise<void> {
        if (!this.isUnfurlUrl(unfurlUrl)
            || this.unfurlPreviewByUrl.has(unfurlUrl)
            || this.pendingUnfurlPreviewUrls.has(unfurlUrl)) {
            return;
        }

        this.pendingUnfurlPreviewUrls.add(unfurlUrl);

        try {
            const fallbackTarget = this.resolveTargetFromUnfurlUrl(unfurlUrl) ?? unfurlUrl;
            let preview: DockUnfurlPreview = {
                unfurlUrl,
                targetUrl: fallbackTarget,
                title: this.buildUnfurlTitleFromTarget(fallbackTarget),
                description: 'Open shared link'
            };

            const response = await fetch(unfurlUrl);
            if (response.ok) {
                const html = await response.text();
                const title = this.extractMetaContent(html, 'property', 'og:title')
                    ?? this.extractMetaContent(html, 'name', 'twitter:title')
                    ?? preview.title;
                const description = this.extractMetaContent(html, 'property', 'og:description')
                    ?? this.extractMetaContent(html, 'name', 'twitter:description')
                    ?? preview.description;
                const imageUrl = this.extractMetaContent(html, 'property', 'og:image')
                    ?? this.extractMetaContent(html, 'name', 'twitter:image')
                    ?? undefined;
                const targetUrl = this.extractMetaContent(html, 'property', 'og:url')
                    ?? this.extractCanonicalHref(html)
                    ?? fallbackTarget;

                preview = {
                    unfurlUrl,
                    targetUrl: this.toAbsoluteUrl(targetUrl, unfurlUrl),
                    title,
                    description,
                    imageUrl: imageUrl ? this.toAbsoluteUrl(imageUrl, unfurlUrl) : undefined
                };
            }

            this.unfurlPreviewByUrl.set(unfurlUrl, preview);
        } catch {
            // Keep dock unfurl rendering resilient when metadata fetch fails.
        } finally {
            this.pendingUnfurlPreviewUrls.delete(unfurlUrl);
        }
    }

    private scrollThreadToBottomOnNextRender(): void {
        const maxAttempts = 30;

        const scrollToBottom = (attemptsLeft: number, previousHeight = -1) => {
            const container = this.threadListRef?.nativeElement;
            if (!container) {
                if (attemptsLeft > 0) {
                    window.setTimeout(() => scrollToBottom(attemptsLeft - 1, previousHeight), 120);
                }
                return;
            }

            container.scrollTop = container.scrollHeight;

            if (attemptsLeft <= 0) {
                return;
            }

            const currentHeight = container.scrollHeight;
            if (currentHeight !== previousHeight) {
                window.setTimeout(() => scrollToBottom(attemptsLeft - 1, currentHeight), 120);
            }
        };

        requestAnimationFrame(() => scrollToBottom(maxAttempts));
    }

    private previewContent(content: string): string {
        const parsed = this.parsedMessage(content ?? '');
        const text = parsed.text.trim();

        if (text) {
            return text;
        }

        if (parsed.sharedPost) {
            return `Shared post from @${parsed.sharedPost.authorHandle}`;
        }

        if (parsed.sharedStory) {
            const authorHandle = parsed.sharedStory.authorHandle?.trim() ?? '';
            return authorHandle ? `Shared story from @${authorHandle}` : 'Shared story';
        }

        if (parsed.sharedReel) {
            const authorHandle = parsed.sharedReel.authorHandle?.trim() ?? '';
            return authorHandle ? `Shared reel from @${authorHandle}` : 'Shared reel';
        }

        if (parsed.unfurlUrl) {
            return 'Shared link';
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

        if (trimmed.startsWith('data:')) {
            return trimmed;
        }

        if (trimmed.startsWith('/')) {
            return this.apiOrigin ? `${this.apiOrigin}${trimmed}` : trimmed;
        }

        try {
            const url = new URL(trimmed);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return null;
            }

            const isLocalHost = url.hostname === 'localhost'
                || url.hostname === '127.0.0.1'
                || url.hostname === '0.0.0.0';

            if (this.apiOrigin && isLocalHost) {
                return `${this.apiOrigin}${url.pathname}${url.search}${url.hash}`;
            }

            return url.toString();
        } catch {
            return null;
        }
    }

    private resolveApiOrigin(): string {
        try {
            return new URL(environment.apiBaseUrl).origin;
        } catch {
            return '';
        }
    }

    private isGifUrl(url: string): boolean {
        const lower = url.toLowerCase();
        return /\.gif($|\?)/.test(lower) || lower.includes('giphy.com') || lower.includes('tenor.com');
    }

    private isImageUrl(url: string): boolean {
        return /\.(png|jpe?g|webp|bmp|svg)(\?|$)/i.test(url);
    }

    private isVideoUrl(url: string): boolean {
        return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
    }

    private isUnfurlUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return parsed.pathname.toLowerCase().startsWith(MessagesDockComponent.UnfurlPrefix);
        } catch {
            return false;
        }
    }

    private extractUnfurlUrlFromText(text: string): string | null {
        const urls = Array.from((text ?? '').matchAll(/https?:\/\/\S+/gi))
            .map(match => this.normalizedMediaUrl(match[0] ?? ''))
            .filter((url): url is string => !!url && this.isUnfurlUrl(url));

        return urls[0] ?? null;
    }

    private resolveTargetFromUnfurlUrl(unfurlUrl: string): string | null {
        try {
            const parsed = new URL(unfurlUrl);
            const prefixIndex = parsed.pathname.toLowerCase().indexOf(MessagesDockComponent.UnfurlPrefix);
            if (prefixIndex < 0) {
                return null;
            }

            const encodedTargetPath = parsed.pathname.slice(prefixIndex + MessagesDockComponent.UnfurlPrefix.length);
            if (!encodedTargetPath) {
                return null;
            }

            const targetPath = `/${encodedTargetPath}`;
            return `${window.location.origin}${targetPath}`;
        } catch {
            return null;
        }
    }

    private buildUnfurlTitleFromTarget(targetUrl: string): string {
        try {
            const parsed = new URL(targetUrl);
            const segment = parsed.pathname.split('/').filter(Boolean).slice(-1)[0] ?? 'shared-link';
            return segment
                .replace(/[-_]+/g, ' ')
                .trim()
                .replace(/\b\w/g, value => value.toUpperCase()) || 'Shared link';
        } catch {
            return 'Shared link';
        }
    }

    private extractMetaContent(html: string, keyName: 'property' | 'name', keyValue: string): string | null {
        const escapedKey = keyValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const metaRegex = new RegExp(`<meta[^>]*${keyName}=[\"']${escapedKey}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`, 'i');
        const reverseMetaRegex = new RegExp(`<meta[^>]*content=[\"']([^\"']+)[\"'][^>]*${keyName}=[\"']${escapedKey}[\"'][^>]*>`, 'i');

        const directMatch = html.match(metaRegex)?.[1]?.trim();
        if (directMatch) {
            return directMatch;
        }

        const reverseMatch = html.match(reverseMetaRegex)?.[1]?.trim();
        return reverseMatch || null;
    }

    private extractCanonicalHref(html: string): string | null {
        const canonicalRegex = /<link[^>]*rel=[\"']canonical[\"'][^>]*href=[\"']([^\"']+)[\"'][^>]*>/i;
        const reverseCanonicalRegex = /<link[^>]*href=[\"']([^\"']+)[\"'][^>]*rel=[\"']canonical[\"'][^>]*>/i;
        return html.match(canonicalRegex)?.[1]?.trim()
            ?? html.match(reverseCanonicalRegex)?.[1]?.trim()
            ?? null;
    }

    private toAbsoluteUrl(url: string, baseUrl: string): string {
        try {
            return new URL(url, baseUrl).toString();
        } catch {
            return url;
        }
    }

    private navigateToUrl(targetUrl: string): void {
        try {
            const parsed = new URL(targetUrl, window.location.origin);
            if (parsed.origin === window.location.origin) {
                this.open = false;
                void this.router.navigateByUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`);
                return;
            }

            window.location.href = parsed.toString();
        } catch {
            window.location.href = targetUrl;
        }
    }

    private sharedReelKey(sharedReel: SharedReelPreview): string {
        return sharedReel.reelId?.trim() || sharedReel.videoUrl?.trim() || sharedReel.thumbnailUrl?.trim() || '';
    }

    private markSharedReelUnavailable(sharedReel: SharedReelPreview): void {
        const key = this.sharedReelKey(sharedReel);
        if (!key) {
            return;
        }

        this.unavailableSharedReelKeys.add(key);
    }

    openNewChatSearch(): void {
        this.newChatSearchOpen = true;
        this.newChatSearchQuery = '';
        this.newChatFilteredProfiles = [];
        this.newChatSuggestedFollowingProfiles = [];
        this.newChatSuggestedRelevantProfiles = [];
        this.newChatError = '';
        void this.newChatLoadProfileSuggestions();
    }

    closeNewChatSearch(event?: Event): void {
        event?.stopPropagation();
        this.newChatSearchOpen = false;
        if (this.newChatSearchProfilesDebounceId !== null) {
            window.clearTimeout(this.newChatSearchProfilesDebounceId);
            this.newChatSearchProfilesDebounceId = null;
        }
    }

    onNewChatQueryInput(query: string): void {
        this.newChatSearchQuery = query;
        if (this.newChatSearchProfilesDebounceId !== null) {
            window.clearTimeout(this.newChatSearchProfilesDebounceId);
            this.newChatSearchProfilesDebounceId = null;
        }

        this.newChatSearchingProfiles = true;
        this.newChatSearchProfilesDebounceId = window.setTimeout(() => {
            this.newChatSearchProfilesDebounceId = null;
            void this.newChatSearchProfiles(query);
        }, 250);
    }

    private async newChatSearchProfiles(query: string): Promise<void> {
        const currentQuery = query.trim();
        if (!currentQuery) {
            this.newChatSearchingProfiles = false;
            this.newChatFilteredProfiles = [];
            return;
        }

        try {
            const profiles = await this.session.searchProfilesAsync(currentQuery);
            if (this.newChatSearchQuery.trim() !== currentQuery) {
                return;
            }

            const myProfile = this.session.profile;
            const myId = myProfile?.id ?? null;
            const myHandle = myProfile?.handle?.toLowerCase() ?? null;

            this.newChatFilteredProfiles = profiles.filter(profile => {
                if (myId && profile.id === myId) {
                    return false;
                }

                if (myHandle && profile.handle.toLowerCase() === myHandle) {
                    return false;
                }

                return true;
            });
            this.newChatError = '';
        } catch {
            if (this.newChatSearchQuery.trim() !== currentQuery) {
                return;
            }

            this.newChatFilteredProfiles = [];
            this.newChatError = 'Could not search users right now.';
        } finally {
            if (this.newChatSearchQuery.trim() === currentQuery) {
                this.newChatSearchingProfiles = false;
            }
        }
    }

    private async newChatLoadProfileSuggestions(): Promise<void> {
        if (!this.newChatSearchOpen) {
            return;
        }

        this.newChatLoadingProfileSuggestions = true;

        try {
            const suggestions = await this.session.loadFollowSuggestionsAsync(10);
            if (!this.newChatSearchOpen || this.newChatSearchQuery.trim()) {
                return;
            }

            this.newChatSuggestedFollowingProfiles = suggestions.following;
            this.newChatSuggestedRelevantProfiles = suggestions.relevant;
            this.newChatError = '';
        } catch {
            if (!this.newChatSearchOpen || this.newChatSearchQuery.trim()) {
                return;
            }

            this.newChatSuggestedFollowingProfiles = [];
            this.newChatSuggestedRelevantProfiles = [];
            this.newChatError = 'Could not load suggestions right now.';
        } finally {
            if (this.newChatSearchOpen && !this.newChatSearchQuery.trim()) {
                this.newChatLoadingProfileSuggestions = false;
            }
        }
    }

    onNewChatSelectProfile(profile: ProfileDto): void {
        const myProfile = this.session.profile;
        const isCurrentUser = (myProfile?.id && profile.id === myProfile.id)
            || (!!myProfile?.handle && profile.handle.toLowerCase() === myProfile.handle.toLowerCase());
        if (isCurrentUser) {
            return;
        }

        this.closeNewChatSearch();
        void this.newChatStartDirectChat(profile.id);
    }

    private async newChatStartDirectChat(profileId: string): Promise<void> {
        this.status = '';

        try {
            const conversation = await this.session.createDirectConversationAsync(profileId);
            this.dockStartedConversationIds.add(conversation.id);
            const existingIndex = this.conversations.findIndex(x => x.id === conversation.id);
            if (existingIndex >= 0) {
                const next = [...this.conversations];
                next[existingIndex] = conversation;
                this.conversations = next;
            } else {
                this.conversations = [conversation, ...this.conversations];
            }

            this.activeConversation = conversation;
            this.messages = [];
            void this.openConversation(conversation);
        } catch {
            this.status = 'Could not start chat.';
        }
    }

    get newChatShowingSearchResults(): boolean {
        return !!this.newChatSearchQuery.trim();
    }

    get newChatHasSuggestions(): boolean {
        return this.newChatSuggestedFollowingProfiles.length > 0 || this.newChatSuggestedRelevantProfiles.length > 0;
    }
}
