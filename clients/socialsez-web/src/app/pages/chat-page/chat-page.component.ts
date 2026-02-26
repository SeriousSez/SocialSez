import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, DestroyRef, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ChatConversationDto, ChatMessageDto, ChatParticipantDto, ProfileDto, ReactionSummaryDto, ReelCommentDto, ReelDto, StoryDto, StoryGroupDto } from '../../core/api.types';
import { ChatRealtimeService } from '../../core/chat-realtime.service';
import { ReelInteractionsService } from '../../core/reel-interactions.service';
import { executeReelShareToChat } from '../../core/reel-share-to-chat.utils';
import { SharedReelCommentPreview, SharedReelPreview, decodeSharedReelPayload } from '../../core/shared-reel.utils';
import { SharedPostPreview, buildSharedPostMarker, decodeSharedPostPayload } from '../../core/shared-post.utils';
import { SharedStoryPreview, buildSharedStoryMarker as buildStoryShareMarker, buildSharedStoryPreview, decodeSharedStoryPayload } from '../../core/shared-story.utils';
import { cancelStoryShareModal, openStoryShareModal } from '../../core/story-share-modal-state.utils';
import { executeStoryShareToChat as executeStoryShareToChatCore } from '../../core/story-share-to-chat.utils';
import { SessionService } from '../../core/session.service';
import { ChatReplyPreview, buildChatReplyMarker, decodeChatReplyPayload, isChatReplyMarker, stripChatReplyMarkerPrefix } from '../../core/chat-reply.utils';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { FeedStoryViewerComponent } from '../feed-page/feed-story-viewer.component';
import { ChatSearchModalComponent } from '../../shared/chat-search-modal/chat-search-modal.component';
import { ReactionPickerComponent } from '../../shared/reaction-picker/reaction-picker.component';
import { ShareReelMessageModalComponent, ShareReelMessageSubmit } from '../../shared/share-reel-message-modal/share-reel-message-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { environment } from '../../../environments/environment';
import 'emoji-picker-element';

interface ParsedChatMessage {
    text: string;
    reply?: ChatReplyPreview;
    imageUrl?: string;
    gifUrl?: string;
    sharedPost?: SharedPostPreview;
    sharedReel?: SharedReelPreview;
    sharedStory?: SharedStoryPreview;
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
    imports: [CommonModule, FormsModule, ReactionPickerComponent, SkeletonComponent, ChatSearchModalComponent, ShareReelMessageModalComponent, FeedStoryViewerComponent, ConfirmModalComponent],
    templateUrl: './chat-page.component.html',
    styleUrl: './chat-page.component.scss',
    schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class ChatPageComponent implements OnDestroy {
    private readonly apiOrigin = this.resolveApiOrigin();
    private readonly giphyApiKey = 'iY9dDrlVL8teP0Csu3Y1Fcq3AbyCPPmg';
    private readonly messageGapForTimeBreakMs = 30 * 60 * 1000;
    private readonly messageGapForCompactMs = 5 * 60 * 1000;
    private readonly messagesPageSize = 50;
    private readonly loadOlderScrollTopThresholdPx = 24;
    private readonly messageActionsPreferBelowTopThresholdPx = 220;
    private readonly messageActionsEstimatedWidthPx = 132;
    private readonly sharedPreviewMaxChars = 320;
    private readonly sharedPreviewMaxLines = 7;
    private readonly composerMinHeightPx = 38;
    private readonly composerMaxHeightPx = 120;
    private readonly typingIdleTimeoutMs = 1800;
    private readonly remoteTypingExpiryMs = 3200;
    private readonly preciseDateFormatter = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
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
    loadingOlderMessages = false;
    hasOlderMessages = true;
    showNoOlderMessagesMarker = false;
    sendingMessage = false;
    updatingMessageId: string | null = null;
    messageActionsMessageId: string | null = null;
    messageActionsOpenBelow = false;
    messageActionsMenuLeftPx = 0;
    messageActionsMenuTopPx = 0;
    highlightedReplyTargetMessageId: string | null = null;
    replyingToMessageId: string | null = null;
    replyingToPreview: ChatReplyPreview | null = null;
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
    editingMessageId: string | null = null;
    editingMessageDraft = '';
    gifUrlInput = '';
    gifSearchQuery = '';
    gifResults: GiphyGifResult[] = [];
    searchingGifs = false;
    imageUrlInput: string | null = null;
    sharedPostInput: SharedPostPreview | null = null;
    activeSharedReel: SharedReelPreview | null = null;
    activeSharedReelResolved: ReelDto | null = null;
    loadingSharedReelDetails = false;
    reactingSharedReel = false;
    commentingSharedReel = false;
    sharingSharedReelId: string | null = null;
    updatingSharedReel = false;
    deletingSharedReel = false;
    pendingDeleteSharedReelId: string | null = null;
    sharedReelSettingsMenuOpen = false;
    editingSharedReelCaption = false;
    sharedReelCaptionDraft = '';
    viewerCommentDraft = '';
    replyingToSharedReelCommentId: string | null = null;
    editingSharedReelCommentId: string | null = null;
    editingSharedReelCommentDraft = '';
    reactingSharedReelCommentId: string | null = null;
    deletingSharedReelCommentId: string | null = null;
    pendingDeleteSharedReelCommentId: string | null = null;
    activeSharedReelMuted = true;
    pendingShareReelFromViewer: ReelDto | null = null;
    activeSharedStoryGroup: StoryGroupDto | null = null;
    activeSharedStoryIndex = 0;
    sendingSharedStoryReply = false;
    sharingSharedStoryMessage = false;
    deletingSharedStory = false;
    pendingDeleteSharedStoryId: string | null = null;
    sharedStoryViewerError = '';
    pendingShareStoryFromViewer: StoryDto | null = null;
    sharingSharedStoryId: string | null = null;
    private markingSharedStoryId: string | null = null;
    private pendingSharedStoryViewedSync = false;
    emojiPickerOpen = false;
    gifInputOpen = false;
    uploadingImage = false;
    status = '';
    mobileReactionMessageId: string | null = null;
    private mobileReactionPressTimerId: number | null = null;
    private mobileReactionPressedMessageId: string | null = null;
    private mobileReactionLongPressTriggered = false;
    private readonly mobileReactionLongPressDelayMs = 420;
    private replyTargetHighlightTimerId: number | null = null;
    private localTypingIdleTimerId: number | null = null;
    private localTypingConversationId: string | null = null;
    private localTypingActive = false;
    private readonly remoteTypingProfileIds = new Set<string>();
    private readonly remoteTypingTimerByProfileId = new Map<string, number>();
    private readonly likedSharedStoryIds = new Set<string>();
    private readonly expandedSharedReelReplyRootIds = new Set<string>();
    private readonly unavailableSharedReelKeys = new Set<string>();
    private activeStoryGroups: StoryGroupDto[] = [];

    readonly prefers24HourClock = (() => {
        const hourCycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
        return hourCycle === 'h23' || hourCycle === 'h24';
    })();

    get typingParticipantCount(): number {
        return this.remoteTypingProfileIds.size;
    }

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

    @ViewChild('activeSharedReelVideo')
    private activeSharedReelVideoRef?: ElementRef<HTMLVideoElement>;

    @ViewChild('composerInput')
    private composerInputRef?: ElementRef<HTMLTextAreaElement>;

    private readonly destroyRef = inject(DestroyRef);
    private readonly ngZone = inject(NgZone);
    private searchProfilesDebounceId: number | null = null;

    constructor(
        private readonly session: SessionService,
        private readonly chatRealtime: ChatRealtimeService,
        private readonly reelInteractions: ReelInteractionsService,
        private readonly route: ActivatedRoute,
        private readonly router: Router
    ) {
        this.chatRealtime.messageUpserted$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((message) => {
                this.upsertMessage(message);
                this.applyConversationPreview(message);
            });

        this.chatRealtime.typingChanged$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((typing) => {
                this.ngZone.run(() => {
                    this.handleRemoteTypingChanged(typing.conversationId, typing.profileId, typing.isTyping);
                });
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

        this.session.appChanges$
            .pipe(
                filter(change => change === 'posts' || change === 'profile' || change === 'session'),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                void this.refreshActiveStoryPresence();
            });

        void this.loadConversations();
    }

    ngOnDestroy(): void {
        this.clearMobileReactionLongPressState();
        this.clearReplyTargetHighlight();
        this.resetLocalTypingState();
        this.clearRemoteTypingState();

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
        const path = event.composedPath();
        const isInside = (element: Element | null | undefined): boolean => !!element && path.includes(element);

        if (this.mobileReactionMessageId) {
            const clickedInsideMobileReactionMenu = path.some(
                item => item instanceof HTMLElement && item.classList.contains('mobile-reaction-menu')
            );

            if (!clickedInsideMobileReactionMenu) {
                this.mobileReactionMessageId = null;
            }
        }

        if (this.messageActionsMessageId) {
            const clickedInsideMessageActions = path.some(
                item => item instanceof HTMLElement && (item.classList.contains('message-actions-menu') || item.classList.contains('message-actions-toggle'))
            );

            if (!clickedInsideMessageActions) {
                this.messageActionsMessageId = null;
                this.messageActionsOpenBelow = false;
                this.messageActionsMenuLeftPx = 0;
                this.messageActionsMenuTopPx = 0;
            }
        }

        if (!this.emojiPickerOpen && !this.gifInputOpen) {
            return;
        }

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

    onMessagePressStart(message: ChatMessageDto, event: PointerEvent): void {
        if (event.pointerType !== 'touch') {
            return;
        }

        if (!this.isMobileReactionMode() || this.loadingMessages || this.reactingMessageId === message.id) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (target && this.isMessageInteractionTarget(target)) {
            return;
        }

        this.clearMobileReactionLongPressState();
        this.mobileReactionPressedMessageId = message.id;
        this.mobileReactionLongPressTriggered = false;
        this.mobileReactionPressTimerId = window.setTimeout(() => {
            this.mobileReactionLongPressTriggered = true;
            this.mobileReactionMessageId = message.id;
            this.mobileReactionPressTimerId = null;
        }, this.mobileReactionLongPressDelayMs);
    }

    onMessagePressEnd(event?: PointerEvent): void {
        if (!this.isMobileReactionMode()) {
            return;
        }

        if (event?.pointerType === 'touch' && this.mobileReactionLongPressTriggered) {
            event.preventDefault();
        }

        if (this.mobileReactionPressTimerId !== null) {
            window.clearTimeout(this.mobileReactionPressTimerId);
            this.mobileReactionPressTimerId = null;
        }

        this.mobileReactionPressedMessageId = null;
        this.mobileReactionLongPressTriggered = false;
    }

    onMessagePressCancel(): void {
        this.clearMobileReactionLongPressState();
    }

    onMessageContextMenu(event: MouseEvent): void {
        if (!this.isMobileReactionMode()) {
            return;
        }

        event.preventDefault();
    }

    async onMobileReactionSelected(message: ChatMessageDto, reactionType: string, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        await this.onMessageReactionSelected(message, reactionType);
        this.mobileReactionMessageId = null;
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

    get activeSharedStory(): StoryDto | null {
        const group = this.activeSharedStoryGroup;
        if (!group) {
            return null;
        }

        return group.stories[this.activeSharedStoryIndex] ?? null;
    }

    get hasPreviousSharedStory(): boolean {
        return this.activeSharedStoryIndex > 0;
    }

    get hasNextSharedStory(): boolean {
        const group = this.activeSharedStoryGroup;
        return !!group && this.activeSharedStoryIndex < group.stories.length - 1;
    }

    get canDeleteActiveSharedStory(): boolean {
        const story = this.activeSharedStory;
        const myProfileId = this.currentProfileId;
        if (!story || !myProfileId || story.authorId !== myProfileId) {
            return false;
        }

        return this.isGuid(story.id);
    }

    async loadConversations(): Promise<void> {
        this.loadingConversations = true;
        this.status = '';

        try {
            void this.refreshActiveStoryPresence();
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
        this.stopTypingForConversation(previousConversationId);
        this.selectedConversationId = conversation.id;
        this.selectedConversation = conversation;
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { conversation: conversation.id },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
        this.messages = [];
        this.hasOlderMessages = true;
        this.loadingOlderMessages = false;
        this.showNoOlderMessagesMarker = false;
        this.clearRemoteTypingState();
        this.messageSearchQuery = '';
        this.newMessage = '';
        this.cancelReplyToMessage();
        this.closeMessageActions();
        this.cancelEditingMessage();
        this.loadingMessages = true;
        this.status = '';

        const realtimeSyncTask = this.syncRealtimeMembership(previousConversationId, conversation.id);

        try {
            const loadedMessages = await this.withTimeout(this.session.loadChatMessagesAsync(conversation.id, this.messagesPageSize), 5000);
            this.ngZone.run(() => {
                this.messages = loadedMessages;
                this.hasOlderMessages = loadedMessages.length >= this.messagesPageSize;
            });
            void this.prefetchUnavailableSharedReelsFromMessages(loadedMessages);
        } catch {
            this.ngZone.run(() => {
                this.messages = [];
                this.hasOlderMessages = false;
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

    clearSelectedConversation(): void {
        this.stopTypingForConversation(this.selectedConversationId);
        this.selectedConversationId = null;
        this.selectedConversation = null;
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { conversation: null },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
        this.messages = [];
        this.hasOlderMessages = true;
        this.loadingOlderMessages = false;
        this.showNoOlderMessagesMarker = false;
        this.clearRemoteTypingState();
        this.messageSearchQuery = '';
        this.messageActionsMessageId = null;
        this.messageActionsOpenBelow = false;
        this.messageActionsMenuLeftPx = 0;
        this.messageActionsMenuTopPx = 0;
        this.cancelReplyToMessage();
        this.cancelEditingMessage();
        this.loadingMessages = false;
        this.status = '';
    }

    onMessageListScroll(): void {
        const container = this.messageListRef?.nativeElement;
        if (!container) {
            return;
        }

        const nearTop = container.scrollTop <= this.loadOlderScrollTopThresholdPx;
        if (!nearTop) {
            this.showNoOlderMessagesMarker = false;
            return;
        }

        if (!this.hasOlderMessages) {
            this.showNoOlderMessagesMarker = true;
            return;
        }

        this.showNoOlderMessagesMarker = false;

        if (this.loadingMessages || this.loadingOlderMessages || !this.selectedConversationId) {
            return;
        }

        void this.loadOlderMessages();
    }

    beginReplyToMessage(message: ChatMessageDto, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        const preview = this.buildReplyPreviewFromMessage(message);
        if (!preview) {
            return;
        }

        this.replyingToMessageId = message.id;
        this.replyingToPreview = preview;
        this.closeMessageActions();
    }

    cancelReplyToMessage(): void {
        this.replyingToMessageId = null;
        this.replyingToPreview = null;
    }

    isReplySharedMedia(reply: ChatReplyPreview): boolean {
        return reply.sourceType === 'post' || reply.sourceType === 'reel' || reply.sourceType === 'story';
    }

    replyPreviewThumbnail(reply: ChatReplyPreview): string | undefined {
        const sourceMessage = this.replySourceMessage(reply);
        if (!sourceMessage) {
            return reply.thumbnailUrl;
        }

        const parsed = this.parsedMessage(sourceMessage);
        if (reply.sourceType === 'post') {
            return parsed.sharedPost?.imageUrl ?? reply.thumbnailUrl;
        }

        if (reply.sourceType === 'reel') {
            return parsed.sharedReel?.thumbnailUrl ?? reply.thumbnailUrl;
        }

        if (reply.sourceType === 'story') {
            return parsed.sharedStory?.thumbnailUrl || parsed.sharedStory?.mediaUrl || reply.thumbnailUrl;
        }

        return reply.thumbnailUrl;
    }

    async onReplyPreviewClick(_message: ChatMessageDto, reply: ChatReplyPreview, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        const sourceMessage = this.replySourceMessage(reply);
        const parsed = sourceMessage ? this.parsedMessage(sourceMessage) : null;

        if (reply.sourceType === 'post' && parsed?.sharedPost) {
            this.openSharedPost(parsed.sharedPost, event);
            return;
        }

        if (reply.sourceType === 'reel' && parsed?.sharedReel && sourceMessage) {
            await this.openSharedReel(parsed.sharedReel, sourceMessage, event);
            return;
        }

        if (reply.sourceType === 'story' && parsed?.sharedStory && sourceMessage) {
            this.openSharedStory(parsed.sharedStory, sourceMessage, event);
            return;
        }

        if (reply.messageId) {
            this.scrollToMessageById(reply.messageId);
        }
    }

    composerReplyLabel(reply: ChatReplyPreview): string {
        return `@${reply.authorHandle}`;
    }

    replyPreviewLabel(message: ChatMessageDto, reply: ChatReplyPreview): string {
        const currentHandle = (this.session.profile?.handle ?? '').trim().toLowerCase();
        const repliedToHandle = (reply.authorHandle ?? '').trim();
        const repliedToIsMe = !!currentHandle && repliedToHandle.toLowerCase() === currentHandle;

        const repliedTarget = repliedToIsMe ? 'you' : `@${repliedToHandle}`;
        if (message.authorProfileId === this.currentProfileId) {
            return `You replied to ${repliedTarget}`;
        }

        return `@${message.authorHandle} replied to ${repliedTarget}`;
    }

    replyPreviewText(reply: ChatReplyPreview): string {
        const text = (reply.text ?? '').trim();
        if (text) {
            return text;
        }

        switch (reply.sourceType) {
            case 'image':
                return '📷 Image';
            case 'gif':
                return 'GIF';
            case 'post':
                return 'Shared post';
            case 'reel':
                return 'Shared reel';
            case 'story':
                return 'Shared story';
            default:
                return 'Message';
        }
    }

    isReplyToOwnMessage(reply: ChatReplyPreview): boolean {
        const currentHandle = (this.session.profile?.handle ?? '').trim().toLowerCase();
        if (!currentHandle) {
            return false;
        }

        return (reply.authorHandle ?? '').trim().toLowerCase() === currentHandle;
    }

    canShowMessageActions(message: ChatMessageDto): boolean {
        return !!message;
    }

    isMessageActionsOpen(message: ChatMessageDto): boolean {
        return this.messageActionsMessageId === message.id;
    }

    isMessageActionsOpenBelow(message: ChatMessageDto): boolean {
        return this.isMessageActionsOpen(message) && this.messageActionsOpenBelow;
    }

    toggleMessageActions(message: ChatMessageDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        if (!this.canShowMessageActions(message)) {
            return;
        }

        if (this.messageActionsMessageId === message.id) {
            this.messageActionsMessageId = null;
            this.messageActionsOpenBelow = false;
            this.messageActionsMenuLeftPx = 0;
            this.messageActionsMenuTopPx = 0;
            return;
        }

        const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        const triggerRect = trigger?.getBoundingClientRect();
        const menuOptionCount = this.canEditMessage(message) ? 2 : 1;
        const menuHeaderHeight = 29;
        const estimatedMenuHeight = menuOptionCount * 36 + menuHeaderHeight + 10;
        const edgeGap = 8;
        const viewportEdgePadding = 8;
        const menuWidth = this.messageActionsEstimatedWidthPx;

        if (!triggerRect) {
            this.messageActionsMessageId = message.id;
            this.messageActionsOpenBelow = true;
            this.messageActionsMenuLeftPx = viewportEdgePadding;
            this.messageActionsMenuTopPx = viewportEdgePadding;
            return;
        }

        const availableAbove = triggerRect.top;
        const availableBelow = window.innerHeight - triggerRect.bottom;

        const canOpenAbove = availableAbove >= estimatedMenuHeight + edgeGap;
        const canOpenBelow = availableBelow >= estimatedMenuHeight + edgeGap;
        const nearTopEdge = triggerRect.top < this.messageActionsPreferBelowTopThresholdPx;

        const shouldOpenBelow = nearTopEdge || (!canOpenAbove && (canOpenBelow || availableBelow >= availableAbove));

        const targetLeft = triggerRect.right - menuWidth;
        const maxLeft = window.innerWidth - menuWidth - viewportEdgePadding;
        const clampedLeft = Math.max(viewportEdgePadding, Math.min(targetLeft, maxLeft));

        const rawTop = shouldOpenBelow
            ? triggerRect.bottom + edgeGap
            : triggerRect.top - estimatedMenuHeight - edgeGap;
        const maxTop = window.innerHeight - estimatedMenuHeight - viewportEdgePadding;
        const clampedTop = Math.max(viewportEdgePadding, Math.min(rawTop, maxTop));

        this.messageActionsMessageId = message.id;
        this.messageActionsOpenBelow = shouldOpenBelow;
        this.messageActionsMenuLeftPx = clampedLeft;
        this.messageActionsMenuTopPx = clampedTop;

        requestAnimationFrame(() => {
            if (this.messageActionsMessageId !== message.id) {
                return;
            }

            const menuElement = document.querySelector('.chat-layout .message-actions-menu') as HTMLElement | null;
            const actualWidth = menuElement?.offsetWidth ?? menuWidth;
            const actualHeight = menuElement?.offsetHeight ?? estimatedMenuHeight;

            const refinedTargetLeft = triggerRect.right - actualWidth;
            const refinedMaxLeft = window.innerWidth - actualWidth - viewportEdgePadding;
            this.messageActionsMenuLeftPx = Math.max(viewportEdgePadding, Math.min(refinedTargetLeft, refinedMaxLeft));

            const refinedRawTop = shouldOpenBelow
                ? triggerRect.bottom + edgeGap
                : triggerRect.top - actualHeight - edgeGap;
            const refinedMaxTop = window.innerHeight - actualHeight - viewportEdgePadding;
            this.messageActionsMenuTopPx = Math.max(viewportEdgePadding, Math.min(refinedRawTop, refinedMaxTop));
        });
    }

    closeMessageActions(event?: Event): void {
        event?.stopPropagation();
        this.messageActionsMessageId = null;
        this.messageActionsOpenBelow = false;
        this.messageActionsMenuLeftPx = 0;
        this.messageActionsMenuTopPx = 0;
    }

    beginMessageEditFromMenu(message: ChatMessageDto, event: Event): void {
        this.closeMessageActions(event);
        this.startEditingMessage(message, event);
    }

    async copyMessageText(message: ChatMessageDto, event: Event): Promise<void> {
        this.closeMessageActions(event);

        const content = this.conversationPreview(message.content).trim();
        if (!content) {
            return;
        }

        try {
            await navigator.clipboard.writeText(content);
            this.status = 'Message copied.';
        } catch {
            this.status = 'Could not copy message.';
        }
    }

    isEditingMessage(message: ChatMessageDto): boolean {
        return this.editingMessageId === message.id;
    }

    messageWasEdited(message: ChatMessageDto): boolean {
        return !!message.editedAtUtc;
    }

    canEditMessage(message: ChatMessageDto): boolean {
        if (this.currentProfileId !== message.authorProfileId) {
            return false;
        }

        const parsed = this.parsedMessage(message);
        return !!parsed.text.trim()
            && !parsed.imageUrl
            && !parsed.gifUrl
            && !parsed.sharedPost
            && !parsed.sharedReel
            && !parsed.sharedStory;
    }

    startEditingMessage(message: ChatMessageDto, event?: Event): void {
        event?.stopPropagation();

        if (!this.canEditMessage(message) || this.updatingMessageId !== null) {
            return;
        }

        this.editingMessageId = message.id;
        this.editingMessageDraft = message.content;
        this.status = '';
    }

    cancelEditingMessage(force = false): void {
        if (!force && this.updatingMessageId !== null) {
            return;
        }

        this.editingMessageId = null;
        this.editingMessageDraft = '';
    }

    onEditMessageKeydown(event: KeyboardEvent, message: ChatMessageDto): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.cancelEditingMessage(true);
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void this.saveEditedMessage(message);
        }
    }

    async saveEditedMessage(message: ChatMessageDto): Promise<void> {
        if (this.editingMessageId !== message.id || this.updatingMessageId !== null) {
            return;
        }

        const content = this.editingMessageDraft.trim();
        if (!content) {
            this.status = 'Message content is required.';
            return;
        }

        if (content === message.content) {
            this.cancelEditingMessage();
            return;
        }

        this.updatingMessageId = message.id;
        this.status = '';

        try {
            const updated = await this.session.updateChatMessageAsync(message.id, content);
            this.upsertMessage(updated);
            this.applyConversationPreview(updated);
            this.cancelEditingMessage(true);
        } catch {
            this.status = 'Could not update message.';
        } finally {
            this.updatingMessageId = null;
        }
    }

    async sendMessage(): Promise<void> {
        const conversationId = this.selectedConversationId;
        const content = this.composeOutgoingMessage();
        if (!conversationId || !content || this.sendingMessage) {
            return;
        }

        this.stopTypingForConversation(conversationId);

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
            this.cancelReplyToMessage();
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
        this.notifyLocalTypingActivity();
    }

    onComposerKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }

        event.preventDefault();
        this.stopTypingForConversation(this.selectedConversationId);
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
        this.notifyLocalTypingActivity();
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

        if (parsed.sharedStory) {
            const authorHandle = parsed.sharedStory.authorHandle?.trim() ?? '';
            return authorHandle ? `Shared story from @${authorHandle}` : 'Shared story';
        }

        if (parsed.sharedReel) {
            const authorHandle = parsed.sharedReel.authorHandle?.trim() ?? '';
            return authorHandle ? `Shared reel from @${authorHandle}` : 'Shared reel';
        }

        return text;
    }

    async setMessageReaction(message: ChatMessageDto, reactionType: string): Promise<void> {
        if (this.reactingMessageId || this.loadingMessages) {
            return;
        }

        const shouldStickToBottom = this.isLastMessageInThread(message.id);
        this.reactingMessageId = message.id;
        this.status = '';

        try {
            const updated = await this.session.setMessageReactionAsync(message.id, reactionType);
            this.applyMessageUpdate(updated);
            if (shouldStickToBottom) {
                this.scrollToBottomOnNextRender();
            }
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

        const shouldStickToBottom = this.isLastMessageInThread(message.id);
        this.reactingMessageId = message.id;
        this.status = '';

        try {
            const updated = await this.session.clearMessageReactionAsync(message.id);
            this.applyMessageUpdate(updated);
            if (shouldStickToBottom) {
                this.scrollToBottomOnNextRender();
            }
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
        event.stopPropagation();
        void this.router.navigate(['/users', handle]);
    }

    hasActiveStoryForHandle(handle: string): boolean {
        const normalized = handle.trim().toLowerCase();
        return this.activeStoryGroups.some(group => group.authorHandle.trim().toLowerCase() === normalized);
    }

    hasUnseenStoryForHandle(handle: string): boolean {
        const normalized = handle.trim().toLowerCase();
        return this.activeStoryGroups.some(group => group.authorHandle.trim().toLowerCase() === normalized && group.hasUnseenStories);
    }

    openAvatarProfileOrStory(handle: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const normalized = handle.trim().toLowerCase();
        const group = this.activeStoryGroups.find(item => item.authorHandle.trim().toLowerCase() === normalized);
        if (group?.stories.length) {
            this.openSharedStoryGroup(group);
            return;
        }

        void this.router.navigate(['/users', handle]);
    }

    openHashtag(tag: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
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

    openSharedPost(shared: SharedPostPreview, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/shared/post', shared.postId]);
    }

    async openSharedReel(sharedReel: SharedReelPreview, message: ChatMessageDto, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        if (this.isSharedReelUnavailable(sharedReel)) {
            this.status = 'Reel was deleted.';
            return;
        }

        let normalizedSharedReel: SharedReelPreview = {
            ...sharedReel,
            authorHandle: sharedReel.authorHandle?.trim() || message.authorHandle,
            authorImageUrl: sharedReel.authorImageUrl || message.authorImageUrl,
            createdAtUtc: sharedReel.createdAtUtc || message.createdAtUtc
        };

        const reelId = normalizedSharedReel.reelId?.trim() ?? '';
        if (reelId) {
            this.loadingSharedReelDetails = true;
            try {
                const foundById = await this.session.loadPublicReelByIdAsync(reelId);
                if (!foundById) {
                    this.markSharedReelUnavailable(normalizedSharedReel);
                    this.status = 'Reel was deleted.';
                    return;
                }

                normalizedSharedReel = {
                    ...normalizedSharedReel,
                    videoUrl: foundById.videoUrl || normalizedSharedReel.videoUrl,
                    thumbnailUrl: foundById.thumbnailUrl || normalizedSharedReel.thumbnailUrl,
                    caption: foundById.caption || normalizedSharedReel.caption,
                    authorHandle: foundById.authorHandle || normalizedSharedReel.authorHandle,
                    authorImageUrl: foundById.authorImageUrl || normalizedSharedReel.authorImageUrl,
                    likeCount: foundById.likeCount,
                    likedByMe: foundById.likedByMe,
                    comments: foundById.comments.map(comment => this.mapReelComment(comment)),
                    createdAtUtc: foundById.createdAtUtc || normalizedSharedReel.createdAtUtc
                };
            } catch {
                this.status = 'Could not open this reel right now.';
                return;
            } finally {
                this.loadingSharedReelDetails = false;
            }
        }

        this.viewerCommentDraft = '';
        this.activeSharedReelMuted = true;
        this.sharedReelSettingsMenuOpen = false;
        this.editingSharedReelCaption = false;
        this.sharedReelCaptionDraft = '';
        this.pendingShareReelFromViewer = null;
        this.replyingToSharedReelCommentId = null;
        this.editingSharedReelCommentId = null;
        this.editingSharedReelCommentDraft = '';
        this.reactingSharedReelCommentId = null;
        this.deletingSharedReelCommentId = null;
        this.pendingDeleteSharedReelCommentId = null;
        this.expandedSharedReelReplyRootIds.clear();
        this.activeSharedReelResolved = this.buildFallbackReelDto(normalizedSharedReel);
        this.activeSharedReel = {
            ...normalizedSharedReel
        };

        void this.resolveSharedReelDetails(normalizedSharedReel);
    }

    openSharedStory(sharedStory: SharedStoryPreview, message: ChatMessageDto, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const fallbackStory = this.buildSharedStoryFromPreview(sharedStory, message);
        this.activeSharedStoryGroup = {
            authorId: fallbackStory.authorId,
            authorHandle: fallbackStory.authorHandle,
            authorImageUrl: fallbackStory.authorImageUrl,
            hasUnseenStories: true,
            stories: [fallbackStory]
        };
        this.activeSharedStoryIndex = 0;
        this.sharedStoryViewerError = '';
        this.sendingSharedStoryReply = false;
        this.sharingSharedStoryMessage = false;
        this.pendingShareStoryFromViewer = null;
        this.sharingSharedStoryId = null;
        void this.markActiveSharedStoryViewed();

        void this.resolveSharedStoryGroup(sharedStory, message, fallbackStory);
    }

    closeSharedStoryViewer(): void {
        this.activeSharedStoryGroup = null;
        this.activeSharedStoryIndex = 0;
        this.sharedStoryViewerError = '';
        this.sendingSharedStoryReply = false;
        this.sharingSharedStoryMessage = false;
        this.deletingSharedStory = false;
        this.pendingDeleteSharedStoryId = null;
        this.pendingShareStoryFromViewer = null;
        this.sharingSharedStoryId = null;
    }

    showPreviousSharedStory(): void {
        if (!this.hasPreviousSharedStory) {
            return;
        }

        this.activeSharedStoryIndex -= 1;
        this.sharedStoryViewerError = '';
        void this.markActiveSharedStoryViewed();
    }

    showNextSharedStory(): void {
        if (!this.hasNextSharedStory) {
            this.closeSharedStoryViewer();
            return;
        }

        this.activeSharedStoryIndex += 1;
        this.sharedStoryViewerError = '';
        void this.markActiveSharedStoryViewed();
    }

    isActiveSharedStoryLiked(storyId: string): boolean {
        return this.likedSharedStoryIds.has(storyId);
    }

    toggleSharedStoryLike(story: StoryDto): void {
        if (this.likedSharedStoryIds.has(story.id)) {
            this.likedSharedStoryIds.delete(story.id);
            return;
        }

        this.likedSharedStoryIds.add(story.id);
    }

    async sendSharedStoryReply(event: { story: StoryDto; message: string }): Promise<void> {
        const conversationId = this.selectedConversationId;
        const content = event.message.trim();
        if (!conversationId || !content || this.sendingSharedStoryReply) {
            return;
        }

        this.sendingSharedStoryReply = true;
        this.sharedStoryViewerError = '';

        try {
            const created = await this.session.sendChatMessageAsync(conversationId, content);
            this.upsertMessage(created);
            this.applyConversationPreview(created);
        } catch {
            this.sharedStoryViewerError = 'Could not send your story reply right now.';
        } finally {
            this.sendingSharedStoryReply = false;
        }
    }

    requestDeleteActiveSharedStory(story: StoryDto): void {
        if (this.deletingSharedStory || !this.canDeleteActiveSharedStory) {
            return;
        }

        this.pendingDeleteSharedStoryId = story.id;
    }

    cancelDeleteActiveSharedStory(): void {
        if (this.deletingSharedStory) {
            return;
        }

        this.pendingDeleteSharedStoryId = null;
    }

    async confirmDeleteActiveSharedStory(): Promise<void> {
        const story = this.activeSharedStory;
        if (!story || this.pendingDeleteSharedStoryId !== story.id || this.deletingSharedStory || !this.canDeleteActiveSharedStory) {
            return;
        }

        this.deletingSharedStory = true;
        this.sharedStoryViewerError = '';

        try {
            await this.session.deleteStoryAsync(story.id);
            const group = this.activeSharedStoryGroup;
            if (!group) {
                this.closeSharedStoryViewer();
                return;
            }

            const nextStories = group.stories.filter(item => item.id !== story.id);
            if (!nextStories.length) {
                this.closeSharedStoryViewer();
                return;
            }

            const nextIndex = Math.min(this.activeSharedStoryIndex, nextStories.length - 1);
            this.activeSharedStoryGroup = {
                ...group,
                stories: nextStories
            };
            this.activeSharedStoryIndex = nextIndex;
            this.pendingShareStoryFromViewer = null;
        } catch {
            this.sharedStoryViewerError = 'Could not delete this story right now.';
        } finally {
            this.pendingDeleteSharedStoryId = null;
            this.deletingSharedStory = false;
        }
    }

    openSharedStoryShareModal(story: StoryDto): void {
        const state = {
            sharingStoryId: this.sharingSharedStoryId,
            pendingShareStory: this.pendingShareStoryFromViewer
        };

        if (!openStoryShareModal(state, story, this.sharingSharedStoryMessage)) {
            return;
        }

        this.pendingShareStoryFromViewer = state.pendingShareStory;
        this.sharedStoryViewerError = '';
    }

    cancelSharedStoryShareModal(): void {
        const state = {
            sharingStoryId: this.sharingSharedStoryId,
            pendingShareStory: this.pendingShareStoryFromViewer
        };

        if (!cancelStoryShareModal(state)) {
            return;
        }

        this.pendingShareStoryFromViewer = state.pendingShareStory;
    }

    async submitSharedStoryShareAsMessage(request: ShareReelMessageSubmit): Promise<void> {
        const story = this.pendingShareStoryFromViewer;
        if (!story) {
            return;
        }

        const succeeded = await this.executeStoryShareToChat(story, request);
        if (succeeded) {
            this.pendingShareStoryFromViewer = null;
        }
    }

    get pendingShareStoryAsReel(): ReelDto | null {
        const story = this.pendingShareStoryFromViewer;
        if (!story) {
            return null;
        }

        return {
            id: story.id,
            authorId: story.authorId,
            authorHandle: story.authorHandle,
            authorImageUrl: story.authorImageUrl,
            caption: story.caption,
            videoUrl: story.mediaUrl,
            thumbnailUrl: this.isImageMedia(story.mediaUrl) ? story.mediaUrl : undefined,
            durationSeconds: 0,
            createdAtUtc: story.createdAtUtc,
            likeCount: 0,
            likedByMe: false,
            comments: []
        };
    }

    closeSharedReelViewer(): void {
        this.activeSharedReel = null;
        this.activeSharedReelResolved = null;
        this.activeSharedReelMuted = true;
        this.loadingSharedReelDetails = false;
        this.reactingSharedReel = false;
        this.commentingSharedReel = false;
        this.sharingSharedReelId = null;
        this.updatingSharedReel = false;
        this.deletingSharedReel = false;
        this.pendingDeleteSharedReelId = null;
        this.sharedReelSettingsMenuOpen = false;
        this.editingSharedReelCaption = false;
        this.sharedReelCaptionDraft = '';
        this.viewerCommentDraft = '';
        this.pendingShareReelFromViewer = null;
        this.replyingToSharedReelCommentId = null;
        this.editingSharedReelCommentId = null;
        this.editingSharedReelCommentDraft = '';
        this.reactingSharedReelCommentId = null;
        this.deletingSharedReelCommentId = null;
        this.pendingDeleteSharedReelCommentId = null;
        this.expandedSharedReelReplyRootIds.clear();
    }

    onSharedReelViewerBackdropClick(event: MouseEvent): void {
        if (event.target !== event.currentTarget) {
            return;
        }

        this.closeSharedReelViewer();
    }

    toggleActiveSharedReelSound(): void {
        this.activeSharedReelMuted = !this.activeSharedReelMuted;
        this.syncActiveSharedReelVideoAudioState();
    }

    get canManageActiveSharedReel(): boolean {
        const reel = this.activeSharedReelResolved;
        const myProfileId = this.currentProfileId;
        return !!reel?.id && !!myProfileId && reel.authorId === myProfileId;
    }

    toggleSharedReelSettingsMenu(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.deletingSharedReel) {
            return;
        }

        this.sharedReelSettingsMenuOpen = !this.sharedReelSettingsMenuOpen;
    }

    startActiveSharedReelCaptionEdit(): void {
        if (!this.canManageActiveSharedReel || this.updatingSharedReel || this.deletingSharedReel) {
            return;
        }

        this.sharedReelCaptionDraft = this.activeSharedReelCaptionText;
        this.editingSharedReelCaption = true;
        this.sharedReelSettingsMenuOpen = false;
    }

    cancelActiveSharedReelCaptionEdit(): void {
        if (this.updatingSharedReel) {
            return;
        }

        this.editingSharedReelCaption = false;
        this.sharedReelCaptionDraft = '';
    }

    async saveActiveSharedReelCaptionEdit(): Promise<void> {
        const reel = this.activeSharedReelResolved;
        if (!reel?.id || !this.canManageActiveSharedReel || this.updatingSharedReel || this.deletingSharedReel) {
            return;
        }

        this.updatingSharedReel = true;
        this.status = '';

        try {
            const captionPayload = this.buildActiveSharedReelCaptionPayload(this.sharedReelCaptionDraft);
            const updated = await this.session.updateReelAsync(reel.id, captionPayload);
            this.activeSharedReelResolved = updated;
            if (this.activeSharedReel) {
                this.activeSharedReel = {
                    ...this.activeSharedReel,
                    caption: updated.caption,
                    comments: updated.comments.map(comment => this.mapReelComment(comment)),
                    likeCount: updated.likeCount,
                    likedByMe: updated.likedByMe,
                    createdAtUtc: updated.createdAtUtc,
                    thumbnailUrl: updated.thumbnailUrl || this.activeSharedReel.thumbnailUrl,
                    authorImageUrl: updated.authorImageUrl || this.activeSharedReel.authorImageUrl
                };
            }

            this.editingSharedReelCaption = false;
            this.sharedReelCaptionDraft = '';
        } catch {
            this.status = 'Could not update this reel right now.';
        } finally {
            this.updatingSharedReel = false;
        }
    }

    requestDeleteActiveSharedReel(): void {
        const reel = this.activeSharedReelResolved;
        if (!reel?.id || !this.canManageActiveSharedReel || this.deletingSharedReel || this.updatingSharedReel) {
            return;
        }

        this.pendingDeleteSharedReelId = reel.id;
        this.sharedReelSettingsMenuOpen = false;
    }

    cancelDeleteActiveSharedReel(): void {
        if (this.deletingSharedReel) {
            return;
        }

        this.pendingDeleteSharedReelId = null;
    }

    async confirmDeleteActiveSharedReel(): Promise<void> {
        const reel = this.activeSharedReelResolved;
        if (!reel?.id || this.pendingDeleteSharedReelId !== reel.id || !this.canManageActiveSharedReel || this.deletingSharedReel || this.updatingSharedReel) {
            return;
        }

        this.deletingSharedReel = true;
        this.status = '';

        try {
            await this.session.deleteReelAsync(reel.id);
            this.closeSharedReelViewer();
        } catch {
            this.status = 'Could not delete this reel right now.';
        } finally {
            this.pendingDeleteSharedReelId = null;
            this.deletingSharedReel = false;
        }
    }

    onActiveSharedReelVideoLoaded(): void {
        this.syncActiveSharedReelVideoAudioState();
    }

    get activeSharedReelLikeCount(): number {
        if (this.activeSharedReelResolved) {
            return this.activeSharedReelResolved.likeCount;
        }

        return Math.max(0, this.activeSharedReel?.likeCount ?? 0);
    }

    get activeSharedReelLikedByMe(): boolean {
        if (this.activeSharedReelResolved) {
            return this.activeSharedReelResolved.likedByMe;
        }

        return !!this.activeSharedReel?.likedByMe;
    }

    get activeSharedReelCaptionText(): string {
        return this.parseReelMetadata(this.activeSharedReelResolved?.caption ?? this.activeSharedReel?.caption).caption;
    }

    get activeSharedReelAuthorHandle(): string {
        return this.normalizeProfileHandle(this.activeSharedReelResolved?.authorHandle ?? this.activeSharedReel?.authorHandle ?? '');
    }

    get activeSharedReelLocation(): string {
        return this.parseReelMetadata(this.activeSharedReelResolved?.caption ?? this.activeSharedReel?.caption).location;
    }

    get activeSharedReelCollaborators(): string[] {
        return this.parseReelMetadata(this.activeSharedReelResolved?.caption ?? this.activeSharedReel?.caption).collaborators;
    }

    get activeSharedReelFrameTransform(): string {
        const metadata = this.parseReelMetadata(this.activeSharedReelResolved?.caption ?? this.activeSharedReel?.caption);
        return `translate(${metadata.frameOffsetX}%, ${metadata.frameOffsetY}%) scale(${metadata.frameZoom})`;
    }

    get activeSharedReelComments(): SharedReelCommentPreview[] {
        if (this.activeSharedReelResolved) {
            return this.activeSharedReelResolved.comments.map(comment => this.mapReelComment(comment));
        }

        return this.activeSharedReel?.comments ?? [];
    }

    get orderedActiveSharedReelComments(): Array<{ comment: SharedReelCommentPreview; depth: number }> {
        const comments = this.activeSharedReelComments;
        if (!comments.length) {
            return [];
        }

        const byParent = new Map<string, SharedReelCommentPreview[]>();
        const byId = new Set(comments.map(comment => comment.id));
        const roots: SharedReelCommentPreview[] = [];

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

        const sortByCreated = (items: SharedReelCommentPreview[]) => items.sort((a, b) => {
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

        const ordered: Array<{ comment: SharedReelCommentPreview; depth: number }> = [];
        const stack = roots.map(root => ({ comment: root, depth: 0, rootId: root.id })).reverse();

        while (stack.length) {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            const threadExpanded = this.expandedSharedReelReplyRootIds.has(current.rootId);
            if (current.depth > 0 && !threadExpanded) {
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

    getActiveSharedReelReplyCount(rootCommentId: string): number {
        const comments = this.activeSharedReelComments;
        if (!comments.length) {
            return 0;
        }

        const byParent = new Map<string, SharedReelCommentPreview[]>();
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

    isActiveSharedReelReplyThreadExpanded(rootCommentId: string): boolean {
        return this.expandedSharedReelReplyRootIds.has(rootCommentId);
    }

    toggleActiveSharedReelReplyThread(rootCommentId: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        if (!this.getActiveSharedReelReplyCount(rootCommentId)) {
            this.expandedSharedReelReplyRootIds.delete(rootCommentId);
            return;
        }

        if (this.expandedSharedReelReplyRootIds.has(rootCommentId)) {
            this.expandedSharedReelReplyRootIds.delete(rootCommentId);
            return;
        }

        this.expandedSharedReelReplyRootIds.add(rootCommentId);
    }

    canEditActiveSharedReelComment(comment: SharedReelCommentPreview): boolean {
        const reel = this.activeSharedReelResolved;
        const myProfileId = this.currentProfileId;
        if (!reel?.id || !myProfileId) {
            return false;
        }

        const resolved = this.resolveActiveSharedReelComment(comment.id);
        return !!resolved && resolved.authorId === myProfileId;
    }

    canDeleteActiveSharedReelComment(comment: SharedReelCommentPreview): boolean {
        const reel = this.activeSharedReelResolved;
        const myProfileId = this.currentProfileId;
        if (!reel?.id || !myProfileId) {
            return false;
        }

        const resolved = this.resolveActiveSharedReelComment(comment.id);
        if (!resolved) {
            return false;
        }

        return resolved.authorId === myProfileId || reel.authorId === myProfileId;
    }

    async replyToActiveSharedReelComment(comment: SharedReelCommentPreview, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        const rootId = this.findActiveSharedReelCommentRootId(comment.id) ?? comment.id;
        this.expandedSharedReelReplyRootIds.add(rootId);

        const mentionPrefix = `@${comment.authorHandle} `;
        const existing = this.viewerCommentDraft;
        const trimmed = existing.trim();
        this.viewerCommentDraft = trimmed.startsWith(mentionPrefix.trim())
            ? existing
            : `${mentionPrefix}${trimmed}`.trimEnd();
        this.replyingToSharedReelCommentId = comment.id;
    }

    cancelActiveSharedReelReply(): void {
        this.replyingToSharedReelCommentId = null;
    }

    startActiveSharedReelCommentEdit(comment: SharedReelCommentPreview, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (!this.canEditActiveSharedReelComment(comment)) {
            return;
        }

        this.editingSharedReelCommentId = comment.id;
        this.editingSharedReelCommentDraft = comment.content;
    }

    cancelActiveSharedReelCommentEdit(event?: MouseEvent): void {
        event?.preventDefault();
        event?.stopPropagation();
        this.editingSharedReelCommentId = null;
        this.editingSharedReelCommentDraft = '';
    }

    async saveActiveSharedReelCommentEdit(comment: SharedReelCommentPreview, event: Event): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        const reel = this.activeSharedReelResolved;
        if (!reel?.id || this.commentingSharedReel || this.deletingSharedReelCommentId) {
            return;
        }

        if (!this.canEditActiveSharedReelComment(comment)) {
            return;
        }

        const updatedContent = this.editingSharedReelCommentDraft.trim();
        if (!updatedContent) {
            return;
        }

        this.commentingSharedReel = true;
        try {
            const updated = await this.session.updateReelCommentAsync(reel.id, comment.id, updatedContent);
            this.applyActiveSharedReelUpdate(updated);
            this.cancelActiveSharedReelCommentEdit();
        } catch {
            this.status = 'Could not update reel comment right now.';
        } finally {
            this.commentingSharedReel = false;
        }
    }

    requestDeleteActiveSharedReelComment(comment: SharedReelCommentPreview, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        if (!this.canDeleteActiveSharedReelComment(comment) || this.commentingSharedReel || this.deletingSharedReelCommentId) {
            return;
        }

        this.pendingDeleteSharedReelCommentId = comment.id;
        if (this.editingSharedReelCommentId === comment.id) {
            this.cancelActiveSharedReelCommentEdit();
        }
    }

    cancelDeleteActiveSharedReelComment(): void {
        if (this.deletingSharedReelCommentId) {
            return;
        }

        this.pendingDeleteSharedReelCommentId = null;
    }

    async confirmDeleteActiveSharedReelComment(): Promise<void> {
        const reel = this.activeSharedReelResolved;
        const commentId = this.pendingDeleteSharedReelCommentId;
        if (!reel?.id || !commentId || this.commentingSharedReel || this.deletingSharedReelCommentId) {
            return;
        }

        const pendingComment = this.activeSharedReelComments.find(comment => comment.id === commentId);
        if (!pendingComment || !this.canDeleteActiveSharedReelComment(pendingComment)) {
            this.pendingDeleteSharedReelCommentId = null;
            return;
        }

        this.deletingSharedReelCommentId = commentId;
        this.commentingSharedReel = true;
        try {
            const updated = await this.session.deleteReelCommentAsync(reel.id, commentId);
            this.applyActiveSharedReelUpdate(updated);
        } catch {
            this.status = 'Could not delete reel comment right now.';
        } finally {
            this.pendingDeleteSharedReelCommentId = null;
            this.commentingSharedReel = false;
            this.deletingSharedReelCommentId = null;
        }
    }

    async toggleActiveSharedReelCommentLike(comment: SharedReelCommentPreview, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        const reel = this.activeSharedReelResolved;
        if (!reel?.id || this.commentingSharedReel || this.reactingSharedReelCommentId === comment.id) {
            return;
        }

        this.reactingSharedReelCommentId = comment.id;
        try {
            const updated = await this.session.toggleReelCommentLikeAsync(reel.id, comment.id);
            this.applyActiveSharedReelUpdate(updated);
        } catch {
            this.status = 'Could not update reel comment like right now.';
        } finally {
            this.reactingSharedReelCommentId = null;
        }
    }

    get canSubmitActiveSharedReelComment(): boolean {
        return !this.commentingSharedReel && !!this.viewerCommentDraft.trim() && !!this.activeSharedReelResolved?.id;
    }

    async toggleActiveSharedReelLike(): Promise<void> {
        const reel = this.activeSharedReelResolved;
        if (!reel?.id || this.reactingSharedReel) {
            return;
        }

        this.reactingSharedReel = true;
        try {
            const updated = await this.session.toggleReelLikeAsync(reel.id);
            this.activeSharedReelResolved = updated;
            if (this.activeSharedReel) {
                this.activeSharedReel = {
                    ...this.activeSharedReel,
                    likeCount: updated.likeCount,
                    likedByMe: updated.likedByMe,
                    comments: updated.comments.map(comment => this.mapReelComment(comment))
                };
            }
        } catch {
            this.status = 'Could not update reel like right now.';
        } finally {
            this.reactingSharedReel = false;
        }
    }

    async submitActiveSharedReelComment(): Promise<void> {
        const reel = this.activeSharedReelResolved;
        const content = this.viewerCommentDraft.trim();
        if (!reel?.id || !content || this.commentingSharedReel) {
            return;
        }

        this.commentingSharedReel = true;
        try {
            const updated = await this.session.addReelCommentAsync(reel.id, content, this.replyingToSharedReelCommentId);
            this.applyActiveSharedReelUpdate(updated);
            this.viewerCommentDraft = '';
            this.replyingToSharedReelCommentId = null;
        } catch {
            this.status = 'Could not add reel comment right now.';
        } finally {
            this.commentingSharedReel = false;
        }
    }

    openActiveSharedReelShareModal(): void {
        const reel = this.activeSharedReelResolved ?? (this.activeSharedReel ? this.buildFallbackReelDto(this.activeSharedReel) : null);
        if (!reel || this.sharingSharedReelId) {
            return;
        }

        this.pendingShareReelFromViewer = reel;
    }

    cancelActiveSharedReelShareModal(): void {
        if (this.sharingSharedReelId) {
            return;
        }

        this.pendingShareReelFromViewer = null;
    }

    async submitActiveSharedReelShareAsMessage(request: ShareReelMessageSubmit): Promise<void> {
        const reel = this.pendingShareReelFromViewer;
        if (!reel) {
            return;
        }

        const succeeded = await this.executeReelShareToChat(reel, request);
        if (succeeded) {
            this.pendingShareReelFromViewer = null;
        }
    }

    formatFeedTimestamp(utcValue: string): string {
        const createdAt = this.parseUtcDate(utcValue);
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

    reactionTotalCount(message: ChatMessageDto): number {
        return message.reactions.reduce((sum, reaction) => sum + Math.max(0, reaction.count ?? 0), 0);
    }

    private isMobileReactionMode(): boolean {
        return window.matchMedia('(max-width: 680px)').matches;
    }

    private isMessageInteractionTarget(target: HTMLElement): boolean {
        return !!target.closest(
            'a, button, input, textarea, select, label, [role="button"], .reaction-zone, .mobile-reaction-menu, .hashtag, .mention'
        );
    }

    private clearMobileReactionLongPressState(): void {
        if (this.mobileReactionPressTimerId !== null) {
            window.clearTimeout(this.mobileReactionPressTimerId);
            this.mobileReactionPressTimerId = null;
        }

        this.mobileReactionPressedMessageId = null;
        this.mobileReactionLongPressTriggered = false;
    }

    private clearReplyTargetHighlight(): void {
        if (this.replyTargetHighlightTimerId !== null) {
            window.clearTimeout(this.replyTargetHighlightTimerId);
            this.replyTargetHighlightTimerId = null;
        }

        this.highlightedReplyTargetMessageId = null;
    }

    private handleRemoteTypingChanged(conversationId: string, profileId: string, isTyping: boolean): void {
        if (!conversationId || !profileId || this.selectedConversationId !== conversationId) {
            return;
        }

        if (profileId === this.currentProfileId) {
            return;
        }

        if (!isTyping) {
            this.removeRemoteTypingProfile(profileId);
            return;
        }

        const hadAnyTyping = this.remoteTypingProfileIds.size > 0;
        this.remoteTypingProfileIds.add(profileId);
        const existingTimer = this.remoteTypingTimerByProfileId.get(profileId);
        if (existingTimer !== undefined) {
            window.clearTimeout(existingTimer);
        }

        const timerId = window.setTimeout(() => {
            this.remoteTypingTimerByProfileId.delete(profileId);
            this.remoteTypingProfileIds.delete(profileId);
        }, this.remoteTypingExpiryMs);

        this.remoteTypingTimerByProfileId.set(profileId, timerId);

        if (!hadAnyTyping) {
            this.scrollToTypingIndicatorOnNextRender();
        }
    }


    private scrollToTypingIndicatorOnNextRender(): void {
        window.setTimeout(() => {
            requestAnimationFrame(() => {
                const container = this.messageListRef?.nativeElement;
                if (!container) {
                    return;
                }

                const indicator = container.querySelector<HTMLElement>('.typing-indicator-row');
                if (indicator) {
                    indicator.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
                    return;
                }

                this.scrollToBottomOnNextRender();
            });
        }, 0);
    }

    private removeRemoteTypingProfile(profileId: string): void {
        const existingTimer = this.remoteTypingTimerByProfileId.get(profileId);
        if (existingTimer !== undefined) {
            window.clearTimeout(existingTimer);
            this.remoteTypingTimerByProfileId.delete(profileId);
        }

        this.remoteTypingProfileIds.delete(profileId);
    }

    private clearRemoteTypingState(): void {
        for (const timerId of this.remoteTypingTimerByProfileId.values()) {
            window.clearTimeout(timerId);
        }

        this.remoteTypingTimerByProfileId.clear();
        this.remoteTypingProfileIds.clear();
    }

    private notifyLocalTypingActivity(): void {
        const conversationId = this.selectedConversationId;
        if (!conversationId) {
            return;
        }

        if (!this.newMessage.trim()) {
            this.stopTypingForConversation(conversationId);
            return;
        }

        if (!this.localTypingActive || this.localTypingConversationId !== conversationId) {
            this.localTypingActive = true;
            this.localTypingConversationId = conversationId;
            void this.chatRealtime.setTyping(conversationId, true).catch(() => { });
        }

        if (this.localTypingIdleTimerId !== null) {
            window.clearTimeout(this.localTypingIdleTimerId);
        }

        this.localTypingIdleTimerId = window.setTimeout(() => {
            this.localTypingIdleTimerId = null;
            this.stopTypingForConversation(this.localTypingConversationId);
        }, this.typingIdleTimeoutMs);
    }

    private stopTypingForConversation(conversationId: string | null): void {
        if (this.localTypingIdleTimerId !== null) {
            window.clearTimeout(this.localTypingIdleTimerId);
            this.localTypingIdleTimerId = null;
        }

        const targetConversationId = conversationId ?? this.localTypingConversationId;
        const shouldBroadcastStop = this.localTypingActive && !!targetConversationId;

        this.localTypingActive = false;
        this.localTypingConversationId = null;

        if (shouldBroadcastStop) {
            void this.chatRealtime.setTyping(targetConversationId!, false).catch(() => { });
        }
    }

    private resetLocalTypingState(): void {
        if (this.localTypingIdleTimerId !== null) {
            window.clearTimeout(this.localTypingIdleTimerId);
            this.localTypingIdleTimerId = null;
        }

        this.localTypingActive = false;
        this.localTypingConversationId = null;
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

    private isLastMessageInThread(messageId: string): boolean {
        const targetId = (messageId ?? '').trim();
        if (!targetId || !this.messages.length) {
            return false;
        }

        const lastMessage = this.messages[this.messages.length - 1];
        return lastMessage?.id === targetId;
    }

    private upsertMessage(updated: ChatMessageDto): void {
        if (this.selectedConversationId !== updated.conversationId) {
            return;
        }

        if (updated.authorProfileId) {
            this.removeRemoteTypingProfile(updated.authorProfileId);
        }

        if (this.editingMessageId === updated.id && this.updatingMessageId === updated.id) {
            this.cancelEditingMessage(true);
        }

        if (this.messageActionsMessageId === updated.id) {
            this.messageActionsMessageId = null;
            this.messageActionsOpenBelow = false;
            this.messageActionsMenuLeftPx = 0;
            this.messageActionsMenuTopPx = 0;
        }

        const index = this.messages.findIndex(x => x.id === updated.id);
        if (index < 0) {
            this.messages = [...this.messages, updated]
                .sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
            this.scrollToBottomOnNextRender();
            void this.prefetchUnavailableSharedReelsFromMessages([updated]);
            return;
        }

        const next = [...this.messages];
        next[index] = updated;
        this.messages = next;
        void this.prefetchUnavailableSharedReelsFromMessages([updated]);
    }

    private async prefetchUnavailableSharedReelsFromMessages(messages: ReadonlyArray<ChatMessageDto>): Promise<void> {
        const byKey = new Map<string, SharedReelPreview>();

        for (const message of messages) {
            const preview = this.parsedMessage(message).sharedReel;
            const reelId = preview?.reelId?.trim();
            if (!preview || !reelId || this.isSharedReelUnavailable(preview)) {
                continue;
            }

            const key = this.sharedReelAvailabilityKey(preview);
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

    private async loadOlderMessages(): Promise<void> {
        const conversationId = this.selectedConversationId;
        const container = this.messageListRef?.nativeElement;
        if (!conversationId || !container) {
            return;
        }

        const skip = this.messages.length;
        if (skip <= 0) {
            return;
        }

        this.loadingOlderMessages = true;
        const previousHeight = container.scrollHeight;
        const previousTop = container.scrollTop;

        try {
            const olderChunk = await this.withTimeout(this.session.loadChatMessagesAsync(conversationId, this.messagesPageSize, skip), 7000);

            if (this.selectedConversationId !== conversationId) {
                return;
            }

            if (!olderChunk.length) {
                this.hasOlderMessages = false;
                return;
            }

            const existingIds = new Set(this.messages.map(message => message.id));
            const uniqueOlder = olderChunk.filter(message => !existingIds.has(message.id));
            if (!uniqueOlder.length) {
                this.hasOlderMessages = false;
                return;
            }

            this.messages = [...uniqueOlder, ...this.messages];
            this.hasOlderMessages = olderChunk.length >= this.messagesPageSize;
            void this.prefetchUnavailableSharedReelsFromMessages(uniqueOlder);

            requestAnimationFrame(() => {
                const currentContainer = this.messageListRef?.nativeElement;
                if (!currentContainer) {
                    return;
                }

                const nextHeight = currentContainer.scrollHeight;
                currentContainer.scrollTop = Math.max(0, nextHeight - previousHeight + previousTop);
            });
        } catch {
            if (this.selectedConversationId === conversationId && !this.status) {
                this.status = 'Could not load older messages.';
            }
        } finally {
            if (this.selectedConversationId === conversationId) {
                this.loadingOlderMessages = false;
            }
        }
    }

    private scrollToMessageById(messageId: string): void {
        const targetId = (messageId ?? '').trim();
        if (!targetId) {
            return;
        }

        const maxAttempts = 8;
        const attemptScroll = (attemptsLeft: number) => {
            const container = this.messageListRef?.nativeElement;
            if (!container) {
                if (attemptsLeft > 0) {
                    window.setTimeout(() => attemptScroll(attemptsLeft - 1), 80);
                }
                return;
            }

            const target = Array.from(container.querySelectorAll<HTMLElement>('article.message[data-message-id]'))
                .find(element => element.getAttribute('data-message-id') === targetId);

            if (!target) {
                if (attemptsLeft > 0) {
                    window.setTimeout(() => attemptScroll(attemptsLeft - 1), 80);
                }
                return;
            }

            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            this.highlightMessageById(targetId);
        };

        requestAnimationFrame(() => attemptScroll(maxAttempts));
    }

    private highlightMessageById(messageId: string): void {
        this.clearReplyTargetHighlight();
        this.highlightedReplyTargetMessageId = messageId;
        this.replyTargetHighlightTimerId = window.setTimeout(() => {
            if (this.highlightedReplyTargetMessageId === messageId) {
                this.highlightedReplyTargetMessageId = null;
            }

            this.replyTargetHighlightTimerId = null;
        }, 1600);
    }

    private replySourceMessage(reply: ChatReplyPreview): ChatMessageDto | null {
        const targetId = (reply.messageId ?? '').trim();
        if (!targetId) {
            return null;
        }

        return this.messages.find(message => message.id === targetId) ?? null;
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
        const replyPreview = this.replyingToPreview;

        const parts: string[] = [];

        if (replyPreview) {
            parts.push(buildChatReplyMarker(replyPreview));
        }

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

    private async resolveSharedReelDetails(preview: SharedReelPreview): Promise<void> {
        this.loadingSharedReelDetails = true;

        try {
            const byPayload = this.buildFallbackReelDto(preview);
            const reelId = preview.reelId?.trim() ?? '';
            const normalizedVideoUrl = this.normalizeComparableUrl(preview.videoUrl);
            let foundById: ReelDto | null = null;

            if (reelId) {
                foundById = await this.session.loadPublicReelByIdAsync(reelId);
                if (!foundById && this.isSameActiveSharedReelPreview(preview)) {
                    this.markSharedReelUnavailable(preview);
                    this.status = 'Reel was deleted.';
                    this.closeSharedReelViewer();
                    return;
                }
            }

            const [forYou, following] = await Promise.allSettled([
                this.session.loadReelFeedAsync(80, 'for-you'),
                this.session.loadReelFeedAsync(80, 'following')
            ]);

            const combined = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            const found = combined.find(reel => (reelId && reel.id === reelId)
                || this.normalizeComparableUrl(reel.videoUrl) === normalizedVideoUrl);

            if (!this.isSameActiveSharedReelPreview(preview)) {
                return;
            }

            this.activeSharedReelResolved = foundById ?? found ?? byPayload;
            if (this.activeSharedReel) {
                this.activeSharedReel = {
                    ...this.activeSharedReel,
                    likeCount: this.activeSharedReelResolved.likeCount,
                    likedByMe: this.activeSharedReelResolved.likedByMe,
                    comments: this.activeSharedReelResolved.comments.map(comment => this.mapReelComment(comment)),
                    caption: this.activeSharedReelResolved.caption,
                    createdAtUtc: this.activeSharedReelResolved.createdAtUtc,
                    thumbnailUrl: this.activeSharedReelResolved.thumbnailUrl || this.activeSharedReel.thumbnailUrl,
                    authorImageUrl: this.activeSharedReelResolved.authorImageUrl || this.activeSharedReel.authorImageUrl
                };
            }
        } catch {
            if (this.activeSharedReel) {
                this.activeSharedReelResolved = this.buildFallbackReelDto(this.activeSharedReel);
            }
        } finally {
            this.loadingSharedReelDetails = false;
        }
    }

    private isSameActiveSharedReelPreview(preview: SharedReelPreview): boolean {
        const active = this.activeSharedReel;
        if (!active) {
            return false;
        }

        const previewId = preview.reelId?.trim();
        const activeId = active.reelId?.trim();
        if (previewId && activeId) {
            return previewId === activeId;
        }

        return this.normalizeComparableUrl(preview.videoUrl) === this.normalizeComparableUrl(active.videoUrl);
    }

    isSharedReelUnavailable(preview: SharedReelPreview): boolean {
        return this.unavailableSharedReelKeys.has(this.sharedReelAvailabilityKey(preview));
    }

    private markSharedReelUnavailable(preview: SharedReelPreview): void {
        this.unavailableSharedReelKeys.add(this.sharedReelAvailabilityKey(preview));
    }

    private sharedReelAvailabilityKey(preview: SharedReelPreview): string {
        const reelId = preview.reelId?.trim();
        if (reelId) {
            return `id:${reelId}`;
        }

        return `url:${this.normalizeComparableUrl(preview.videoUrl)}`;
    }

    private buildFallbackReelDto(preview: SharedReelPreview): ReelDto {
        return {
            id: preview.reelId?.trim() || preview.videoUrl,
            authorId: preview.reelId?.trim() || 'shared-reel',
            authorHandle: preview.authorHandle?.trim() || 'reel',
            authorImageUrl: preview.authorImageUrl,
            caption: preview.caption ?? '',
            videoUrl: preview.videoUrl,
            thumbnailUrl: preview.thumbnailUrl,
            durationSeconds: Math.max(1, Math.round(preview.durationSeconds ?? 1)),
            createdAtUtc: preview.createdAtUtc ?? new Date().toISOString(),
            likeCount: Math.max(0, preview.likeCount ?? 0),
            likedByMe: !!preview.likedByMe,
            comments: (preview.comments ?? []).map(comment => ({
                id: comment.id,
                reelId: preview.reelId?.trim() || preview.videoUrl,
                authorId: comment.id,
                authorHandle: comment.authorHandle,
                authorImageUrl: comment.authorImageUrl,
                parentCommentId: comment.parentCommentId,
                content: comment.content,
                createdAtUtc: comment.createdAtUtc,
                likeCount: Math.max(0, comment.likeCount ?? 0),
                likedByMe: !!comment.likedByMe
            }))
        };
    }

    private applyActiveSharedReelUpdate(updated: ReelDto): void {
        this.activeSharedReelResolved = updated;
        if (this.activeSharedReel) {
            this.activeSharedReel = {
                ...this.activeSharedReel,
                likeCount: updated.likeCount,
                likedByMe: updated.likedByMe,
                comments: updated.comments.map(comment => this.mapReelComment(comment)),
                caption: updated.caption,
                createdAtUtc: updated.createdAtUtc,
                thumbnailUrl: updated.thumbnailUrl || this.activeSharedReel.thumbnailUrl,
                authorImageUrl: updated.authorImageUrl || this.activeSharedReel.authorImageUrl
            };
        }

        this.syncExpandedActiveSharedReelReplyRoots();
    }

    private resolveActiveSharedReelComment(commentId: string): ReelCommentDto | null {
        const reel = this.activeSharedReelResolved;
        if (!reel?.comments?.length) {
            return null;
        }

        return reel.comments.find(comment => comment.id === commentId) ?? null;
    }

    private mapReelComment(comment: ReelCommentDto): SharedReelCommentPreview {
        return {
            id: comment.id,
            parentCommentId: comment.parentCommentId,
            authorHandle: comment.authorHandle,
            authorImageUrl: comment.authorImageUrl,
            content: comment.content,
            createdAtUtc: comment.createdAtUtc,
            likeCount: comment.likeCount,
            likedByMe: comment.likedByMe
        };
    }

    private findActiveSharedReelCommentRootId(commentId: string): string | null {
        const comments = this.activeSharedReelComments;
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

    private syncExpandedActiveSharedReelReplyRoots(): void {
        if (!this.expandedSharedReelReplyRootIds.size) {
            return;
        }

        const replyCounts = new Map<string, number>();
        for (const comment of this.activeSharedReelComments) {
            const parentId = comment.parentCommentId?.trim();
            if (!parentId) {
                continue;
            }

            const rootId = this.findActiveSharedReelCommentRootId(comment.id);
            if (!rootId) {
                continue;
            }

            replyCounts.set(rootId, (replyCounts.get(rootId) ?? 0) + 1);
        }

        for (const rootId of Array.from(this.expandedSharedReelReplyRootIds)) {
            if (!(replyCounts.get(rootId) ?? 0)) {
                this.expandedSharedReelReplyRootIds.delete(rootId);
            }
        }
    }

    private normalizeComparableUrl(value: string): string {
        try {
            const url = new URL(value);
            url.search = '';
            url.hash = '';
            return url.toString();
        } catch {
            return value.trim();
        }
    }

    normalizeProfileHandle(value: string): string {
        return (value ?? '').trim().replace(/^@+/, '');
    }

    isImageMedia(url: string): boolean {
        return this.isImageUrl(url);
    }

    isVideoMedia(url: string): boolean {
        return this.isVideoUrl(url);
    }

    private buildActiveSharedReelCaptionPayload(plainCaption: string): string {
        const source = this.activeSharedReelResolved?.caption ?? this.activeSharedReel?.caption ?? '';
        const metadataLines = source
            .split('\n')
            .map(value => value.trim())
            .filter(value => value.startsWith('📍') || value.startsWith('🤝') || value.startsWith('🎞️FRAME'));

        const caption = plainCaption.trim();
        if (caption) {
            metadataLines.push(caption);
        }

        return metadataLines.join('\n').trim();
    }

    private syncActiveSharedReelVideoAudioState(): void {
        const video = this.activeSharedReelVideoRef?.nativeElement;
        if (!video) {
            return;
        }

        if (this.activeSharedReelMuted) {
            video.setAttribute('muted', '');
            video.muted = true;
            video.defaultMuted = true;
            return;
        }

        video.removeAttribute('muted');
        video.defaultMuted = false;
        video.muted = false;

        video.volume = 1;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            void playPromise.catch(() => { });
        }
    }

    private parseReelMetadata(source: string | undefined): { location: string; collaborators: string[]; caption: string; frameZoom: number; frameOffsetX: number; frameOffsetY: number } {
        const lines = (source ?? '').split('\n').map(value => value.trim()).filter(value => !!value);
        let location = '';
        let collaborators: string[] = [];
        let frameZoom = 1;
        let frameOffsetX = 0;
        let frameOffsetY = 0;
        const captionLines: string[] = [];

        for (const line of lines) {
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

        return {
            location,
            collaborators,
            caption: captionLines.join(' '),
            frameZoom,
            frameOffsetX,
            frameOffsetY
        };
    }

    private parseUtcDate(value: string): Date {
        const hasExplicitTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
        const normalized = hasExplicitTimezone ? value : `${value}Z`;
        return new Date(normalized);
    }

    private async executeReelShareToChat(reel: ReelDto, request: ShareReelMessageSubmit): Promise<boolean> {
        const state = {
            sharingReelId: this.sharingSharedReelId,
            errorMessage: this.status
        };

        const succeeded = await executeReelShareToChat(
            state,
            reel,
            request,
            () => this.reelInteractions.shareToChat(reel, request),
            'Could not send this reel to direct messages right now.'
        );

        this.sharingSharedReelId = state.sharingReelId;
        this.status = state.errorMessage;
        return succeeded;
    }

    private async executeStoryShareToChat(story: StoryDto, request: ShareReelMessageSubmit): Promise<boolean> {
        const state = {
            sharingStoryId: this.sharingSharedStoryId,
            sharingStoryMessage: this.sharingSharedStoryMessage,
            errorMessage: this.sharedStoryViewerError
        };

        const succeeded = await executeStoryShareToChatCore(
            state,
            this.session,
            story,
            request,
            this.buildSharedStoryMarker(story),
            'Could not share this story as a message right now.'
        );

        this.sharingSharedStoryId = state.sharingStoryId;
        this.sharingSharedStoryMessage = state.sharingStoryMessage;
        this.sharedStoryViewerError = state.errorMessage;
        return succeeded;
    }

    private parseMessageContent(content: string): ParsedChatMessage {
        const lines = content.split(/\r?\n/);
        const textLines: string[] = [];
        let reply: ChatReplyPreview | undefined;
        let imageUrl: string | undefined;
        let gifUrl: string | undefined;
        let sharedPost: SharedPostPreview | undefined;
        let sharedReel: SharedReelPreview | undefined;
        let sharedStory: SharedStoryPreview | undefined;

        for (const rawLine of lines) {
            const line = rawLine.trim();

            if (isChatReplyMarker(line)) {
                const parsed = decodeChatReplyPayload(stripChatReplyMarkerPrefix(line));
                if (parsed) {
                    reply = parsed;
                    continue;
                }
            }

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
                }
            }
        }

        if (!sharedStory && !sharedReel && !imageUrl && !gifUrl) {
            const videoUrlFromLine = lines
                .map(line => this.normalizedMediaUrl(line))
                .find((url): url is string => !!url && this.isVideoUrl(url));

            if (videoUrlFromLine) {
                const authorMatch = text.match(/🎬\s*Reel\s+from\s+@([\w.]+)/i);
                const authorHandle = authorMatch?.[1]?.trim() || undefined;
                sharedReel = {
                    authorHandle,
                    videoUrl: videoUrlFromLine
                };

                const reelLeadPattern = /^🎬\s*Reel\s+from\s+@[\w.]+\s*$/i;
                const cleanedLines = textLines
                    .map(line => line.trim())
                    .filter(line => !!line)
                    .filter(line => !reelLeadPattern.test(line))
                    .filter(line => this.normalizedMediaUrl(line) !== videoUrlFromLine);
                text = cleanedLines.join('\n').trim();
            }
        }

        return {
            text: imageUrl || gifUrl ? (text === imageUrl || text === gifUrl ? '' : text) : text,
            reply,
            imageUrl,
            gifUrl,
            sharedPost,
            sharedReel,
            sharedStory
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
        return !!parsed.text && !parsed.imageUrl && !parsed.gifUrl && !parsed.sharedPost && !parsed.sharedReel && !parsed.sharedStory;
    }

    private isSharedOnlyMessage(parsed: ParsedChatMessage): boolean {
        return (!!parsed.sharedPost || !!parsed.sharedReel || !!parsed.sharedStory) && !parsed.text && !parsed.imageUrl && !parsed.gifUrl;
    }

    private messageSearchIndex(content: string): string {
        const parsed = this.parseMessageContent(content);
        return [
            parsed.text,
            parsed.reply?.authorHandle ?? '',
            parsed.reply?.text ?? '',
            parsed.imageUrl ?? '',
            parsed.gifUrl ?? '',
            parsed.sharedPost?.authorHandle ?? '',
            parsed.sharedPost?.content ?? '',
            parsed.sharedReel?.authorHandle ?? '',
            parsed.sharedReel?.caption ?? '',
            parsed.sharedReel?.videoUrl ?? '',
            parsed.sharedStory?.authorHandle ?? '',
            parsed.sharedStory?.mediaUrl ?? ''
        ].join(' ').toLowerCase();
    }

    private buildReplyPreviewFromMessage(message: ChatMessageDto): ChatReplyPreview | null {
        const parsed = this.parsedMessage(message);
        const fallbackText = this.messageSearchIndex(message.content).trim();
        const authorHandle = (message.authorHandle ?? '').trim();

        if (!authorHandle) {
            return null;
        }

        if (parsed.text.trim()) {
            return {
                messageId: message.id,
                authorHandle,
                text: this.trimReplyText(parsed.text),
                sourceType: 'text'
            };
        }

        if (parsed.imageUrl) {
            return {
                messageId: message.id,
                authorHandle,
                text: '📷 Image',
                thumbnailUrl: parsed.imageUrl,
                sourceType: 'image'
            };
        }

        if (parsed.gifUrl) {
            return {
                messageId: message.id,
                authorHandle,
                text: 'GIF',
                thumbnailUrl: parsed.gifUrl,
                sourceType: 'gif'
            };
        }

        if (parsed.sharedPost) {
            return {
                messageId: message.id,
                authorHandle,
                text: 'Shared post',
                thumbnailUrl: parsed.sharedPost.imageUrl,
                sourceType: 'post'
            };
        }

        if (parsed.sharedStory) {
            return {
                messageId: message.id,
                authorHandle,
                text: 'Shared story',
                thumbnailUrl: parsed.sharedStory.thumbnailUrl || parsed.sharedStory.mediaUrl,
                sourceType: 'story'
            };
        }

        if (parsed.sharedReel) {
            return {
                messageId: message.id,
                authorHandle,
                text: 'Shared reel',
                thumbnailUrl: parsed.sharedReel.thumbnailUrl,
                sourceType: 'reel'
            };
        }

        if (fallbackText) {
            return {
                messageId: message.id,
                authorHandle,
                text: this.trimReplyText(fallbackText),
                sourceType: 'text'
            };
        }

        return null;
    }

    private trimReplyText(value: string, maxLength = 80): string {
        const normalized = value.replace(/\s+/g, ' ').trim();
        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
    }

    private buildSharedStoryMarker(story: StoryDto): string {
        return buildStoryShareMarker(buildSharedStoryPreview(story));
    }

    private buildSharedStoryFromPreview(preview: SharedStoryPreview, message: ChatMessageDto): StoryDto {
        const authorHandle = preview.authorHandle?.trim() || message.authorHandle;
        const createdAtUtc = message.createdAtUtc || new Date().toISOString();

        return {
            id: `shared-story-${message.id}`,
            authorId: message.authorProfileId || `shared-story-${authorHandle}`,
            authorHandle,
            authorImageUrl: message.authorImageUrl,
            caption: '',
            mediaUrl: preview.mediaUrl,
            createdAtUtc,
            expiresAtUtc: this.buildSharedStoryExpiresAt(createdAtUtc),
            viewedByMe: false,
            viewCount: 0
        };
    }

    private async resolveSharedStoryGroup(preview: SharedStoryPreview, message: ChatMessageDto, fallbackStory: StoryDto): Promise<void> {
        const normalizedHandle = (preview.authorHandle?.trim() || message.authorHandle || '').toLowerCase();
        const authorId = message.authorProfileId;
        const normalizedMediaUrl = this.normalizeComparableUrl(preview.mediaUrl);

        try {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadStoryFeedAsync(80, 'for-you'),
                this.session.loadStoryFeedAsync(80, 'following')
            ]);

            const groups = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            if (!groups.length || !this.activeSharedStoryGroup?.stories.some(story => story.id === fallbackStory.id)) {
                return;
            }

            const matchedGroup = groups.find(group => {
                if (authorId && group.authorId === authorId) {
                    return true;
                }

                return (group.authorHandle ?? '').trim().toLowerCase() === normalizedHandle;
            });

            if (!matchedGroup?.stories.length) {
                return;
            }

            let matchedIndex = matchedGroup.stories.findIndex(story => this.normalizeComparableUrl(story.mediaUrl) === normalizedMediaUrl);
            if (matchedIndex < 0) {
                matchedIndex = this.getNewestUnseenStoryIndex(matchedGroup.stories);
            }

            this.activeSharedStoryGroup = matchedGroup;
            this.activeSharedStoryIndex = Math.max(0, matchedIndex);
            void this.markActiveSharedStoryViewed();
        } catch {
            // Keep fallback single story when full story group cannot be resolved.
        }
    }

    private buildSharedStoryExpiresAt(createdAtUtc: string): string {
        const createdAt = Date.parse(createdAtUtc);
        if (Number.isNaN(createdAt)) {
            return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }

        return new Date(createdAt + 24 * 60 * 60 * 1000).toISOString();
    }

    private openSharedStoryGroup(group: StoryGroupDto): void {
        if (!group.stories.length) {
            return;
        }

        this.activeSharedStoryGroup = group;
        this.activeSharedStoryIndex = this.getNewestUnseenStoryIndex(group.stories);
        this.sharedStoryViewerError = '';
        this.sendingSharedStoryReply = false;
        this.sharingSharedStoryMessage = false;
        this.deletingSharedStory = false;
        this.pendingDeleteSharedStoryId = null;
        this.pendingShareStoryFromViewer = null;
        this.sharingSharedStoryId = null;
        void this.markActiveSharedStoryViewed();
    }

    private async markActiveSharedStoryViewed(): Promise<void> {
        const story = this.activeSharedStory;
        if (!story || story.viewedByMe) {
            return;
        }

        if (this.markingSharedStoryId) {
            this.pendingSharedStoryViewedSync = true;
            return;
        }

        this.markingSharedStoryId = story.id;
        try {
            await this.session.markStoryViewedAsync(story.id);
            this.markSharedStoryViewedLocally(story.id);
        } catch {
            return;
        } finally {
            this.markingSharedStoryId = null;
            if (this.pendingSharedStoryViewedSync) {
                this.pendingSharedStoryViewedSync = false;
                void this.markActiveSharedStoryViewed();
            }
        }
    }

    private markSharedStoryViewedLocally(storyId: string): void {
        if (this.activeSharedStoryGroup) {
            const updatedStories = this.activeSharedStoryGroup.stories.map(story => story.id === storyId ? { ...story, viewedByMe: true } : story);
            this.activeSharedStoryGroup = {
                ...this.activeSharedStoryGroup,
                stories: updatedStories,
                hasUnseenStories: updatedStories.some(story => !story.viewedByMe)
            };
        }

        this.activeStoryGroups = this.activeStoryGroups.map(group => {
            const hasStory = group.stories.some(story => story.id === storyId);
            if (!hasStory) {
                return group;
            }

            const updatedStories = group.stories.map(story => story.id === storyId ? { ...story, viewedByMe: true } : story);
            return {
                ...group,
                stories: updatedStories,
                hasUnseenStories: updatedStories.some(story => !story.viewedByMe)
            };
        });
    }

    private getNewestUnseenStoryIndex(stories: Array<{ viewedByMe: boolean; createdAtUtc: string }>): number {
        if (!stories.some(story => story.viewedByMe)) {
            let oldestIndex = 0;
            let oldestTimestamp = Number.POSITIVE_INFINITY;

            for (let index = 0; index < stories.length; index += 1) {
                const parsedTimestamp = Date.parse(stories[index].createdAtUtc);
                const timestamp = Number.isNaN(parsedTimestamp) ? Number.POSITIVE_INFINITY : parsedTimestamp;
                if (timestamp < oldestTimestamp) {
                    oldestTimestamp = timestamp;
                    oldestIndex = index;
                }
            }

            return oldestIndex;
        }

        let selectedIndex = -1;
        let selectedTimestamp = Number.NEGATIVE_INFINITY;

        for (let index = 0; index < stories.length; index += 1) {
            const story = stories[index];
            if (story.viewedByMe) {
                continue;
            }

            const parsedTimestamp = Date.parse(story.createdAtUtc);
            const timestamp = Number.isNaN(parsedTimestamp) ? Number.NEGATIVE_INFINITY : parsedTimestamp;
            if (selectedIndex < 0 || timestamp > selectedTimestamp) {
                selectedIndex = index;
                selectedTimestamp = timestamp;
            }
        }

        return selectedIndex >= 0 ? selectedIndex : 0;
    }

    private async refreshActiveStoryPresence(): Promise<void> {
        try {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadStoryFeedAsync(80, 'for-you'),
                this.session.loadStoryFeedAsync(80, 'following')
            ]);

            const merged = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            const deduped = new Map<string, StoryGroupDto>();
            for (const group of merged) {
                const key = group.authorId || group.authorHandle.trim().toLowerCase();
                if (!deduped.has(key)) {
                    deduped.set(key, group);
                }
            }

            this.activeStoryGroups = Array.from(deduped.values());
        } catch {
            this.activeStoryGroups = [];
        }
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
        return /\.(png|jpe?g|webp|bmp|svg|gif)($|\?)/i.test(url);
    }

    private isVideoUrl(url: string): boolean {
        return /\.(mp4|webm|mov|m4v|ogg)($|\?)/i.test(url);
    }

    private isGuid(value: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((value ?? '').trim());
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
