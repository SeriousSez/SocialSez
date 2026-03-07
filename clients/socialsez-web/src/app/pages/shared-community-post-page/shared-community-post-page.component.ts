import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CommunityDto, CommunityPollDto, CommunityPostDto } from '../../core/api.types';
import { expandDiscoveryTerms, scoreDiscoveryFields } from '../../core/discovery-search.util';
import { HashtagTextPart, splitHashtagText } from '../../core/hashtag-text.util';
import { CommunityPostEditorModalComponent, CommunityPostEditorSavePayload } from '../../shared/community-post-editor-modal/community-post-editor-modal.component';
import { RichTextEditorComponent } from '../../shared/rich-text-editor/rich-text-editor.component';
import { SocialSezApiService } from '../../core/socialsez-api.service';
import { SessionService } from '../../core/session.service';

interface CommentThreadItem {
    comment: CommunityPostDto['comments'][number];
    level: number;
}

interface CommentThreadNode {
    comment: CommunityPostDto['comments'][number];
    children: CommentThreadNode[];
}

@Component({
    selector: 'app-shared-community-post-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, RichTextEditorComponent, CommunityPostEditorModalComponent],
    templateUrl: './shared-community-post-page.component.html',
    styleUrl: './shared-community-post-page.component.scss'
})
export class SharedCommunityPostPageComponent {
    @ViewChild('richCommentEditor') richCommentEditor?: ElementRef<HTMLDivElement>;

    loading = true;
    notFound = false;
    error = '';
    post: CommunityPostDto | null = null;
    community: CommunityDto | null = null;
    copiedLink = false;
    postingComment = false;
    votingPost = false;
    votingPollId: string | null = null;
    togglingSavePost = false;
    updatingPost = false;
    editPostModalOpen = false;
    deletingPost = false;
    commentComposerExpanded = false;
    commentEditorMode: 'markdown' | 'rich' = 'rich';
    isBoldCommandActive = false;
    isItalicCommandActive = false;
    isLinkCommandActive = false;
    isUnorderedListCommandActive = false;
    isOrderedListCommandActive = false;
    isQuoteCommandActive = false;
    isSpoilerCommandActive = false;
    commentDraft = '';
    richCommentDraftHtml = '';
    commentError = '';
    commentSearchQuery = '';
    commentSort: 'best' | 'top' | 'new' | 'controversial' | 'old' | 'qna' = 'best';
    commentComposerResetToken = 0;
    replyComposerResetToken = 0;
    activeReplyCommentId: string | null = null;
    activeReplyHandle = '';
    replyDraft = '';
    postingReply = false;
    replyError = '';
    activeEditCommentId: string | null = null;
    editCommentDraft = '';
    savingCommentEdit = false;
    deletingCommentId: string | null = null;
    openCommentMenuId: string | null = null;
    commentActionError = '';
    fullscreenImageUrl: string | null = null;
    fullscreenImageIndex = 0;
    postActiveImageIndex = 0;
    postImageSlideDirection: 'next' | 'prev' = 'next';
    postOutgoingImageUrl: string | null = null;
    postImageAnimating = false;
    copiedCommentId: string | null = null;
    private readonly defaultSpoilerPlaceholder = '|';
    private readonly commentVoteById = new Map<string, -1 | 0 | 1>();
    private readonly pendingCommentSignatures = new Set<string>();
    private readonly recentCommentSignatures = new Map<string, number>();
    private copiedLinkTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private copiedCommentTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private postImageAnimationTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private readonly postImageAnimationMs = 320;
    private readonly apiOrigin = this.resolveApiOrigin();

    constructor(
        private readonly route: ActivatedRoute,
        private readonly api: SocialSezApiService,
        public readonly session: SessionService,
        private readonly cdr: ChangeDetectorRef,
        private readonly ngZone: NgZone
    ) {
        this.route.paramMap.subscribe(params => {
            const postId = (params.get('id') ?? '').trim();
            void this.loadAsync(postId);
        });
    }

    async copyLinkAsync(): Promise<void> {
        const postId = this.post?.id;
        if (!postId) {
            return;
        }

        const link = `${window.location.origin}/cp/${postId}`;
        const copied = await this.copyTextToClipboardAsync(link);
        if (!copied) {
            return;
        }

        this.copiedLink = true;
        if (this.copiedLinkTimeoutId) {
            clearTimeout(this.copiedLinkTimeoutId);
        }

        this.copiedLinkTimeoutId = setTimeout(() => {
            this.copiedLink = false;
            this.copiedLinkTimeoutId = null;
            this.refreshView();
        }, 1800);

        this.refreshView();
    }

    get canSubmitComment(): boolean {
        return this.canCommentInCommunity && !!this.getTopCommentContent();
    }

    get canCommentInCommunity(): boolean {
        if (!this.session.isAuthenticated()) {
            return false;
        }

        if (!this.community?.joinedByMe) {
            return false;
        }

        return !this.isTimedOutInCommunity;
    }

    get isTimedOutInCommunity(): boolean {
        const mutedUntilUtc = this.currentViewerMembership?.mutedUntilUtc;
        if (!mutedUntilUtc) {
            return false;
        }

        const mutedUntilMs = Date.parse(mutedUntilUtc);
        return Number.isFinite(mutedUntilMs) && mutedUntilMs > Date.now();
    }

    get timedOutUntilText(): string {
        const mutedUntilUtc = this.currentViewerMembership?.mutedUntilUtc;
        if (!mutedUntilUtc) {
            return '';
        }

        const mutedUntilDate = new Date(mutedUntilUtc);
        if (Number.isNaN(mutedUntilDate.getTime())) {
            return '';
        }

        return mutedUntilDate.toLocaleString();
    }

    get postTitle(): string {
        const title = (this.post?.title ?? '').trim();
        if (title) {
            return title;
        }
        return 'Untitled post';
    }

    get postBody(): string | null {
        const item = this.post;
        if (!item) {
            return null;
        }

        const content = (item.content ?? '').trim();
        return content || null;
    }

    get postMediaCaption(): string | null {
        const caption = (this.post?.mediaContent ?? '').trim();
        return caption || null;
    }

    splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
        return splitHashtagText(content);
    }

    get postMediaUrls(): string[] {
        const item = this.post;
        if (!item) {
            return [];
        }

        const fromArray = (item.imageUrls ?? [])
            .map(url => url?.trim())
            .filter((url): url is string => !!url);

        if (fromArray.length > 0) {
            return fromArray;
        }

        const single = item.imageUrl?.trim();
        return single ? [single] : [];
    }

    get activePostMediaUrl(): string | null {
        const mediaUrls = this.postMediaUrls;
        if (!mediaUrls.length) {
            return null;
        }

        const safeIndex = Math.min(Math.max(this.postActiveImageIndex, 0), mediaUrls.length - 1);
        return mediaUrls[safeIndex] ?? null;
    }

    get canMovePostImageBack(): boolean {
        return this.postActiveImageIndex > 0;
    }

    get canMovePostImageForward(): boolean {
        return this.postActiveImageIndex < this.postMediaUrls.length - 1;
    }

    get primaryPostLink(): string | null {
        const linkUrl = this.post?.linkUrl?.trim();
        if (linkUrl) {
            return linkUrl;
        }

        const content = this.postBody ?? this.postMediaCaption;
        if (!content) {
            return null;
        }

        const match = content.match(/https?:\/\/[^\s)]+/i);
        return match?.[0] ?? null;
    }

    shouldShowPollResults(poll: CommunityPollDto): boolean {
        if (poll.hasVotedByMe) {
            return true;
        }

        return (poll.options ?? []).some(option => option.votedByMe);
    }

    getPollOptionPercentage(poll: CommunityPollDto, voteCount: number): number {
        const totalVotes = poll.totalVotes ?? 0;
        if (totalVotes <= 0) {
            return 0;
        }

        return Math.round((voteCount / totalVotes) * 100);
    }

    get postVoteScore(): number {
        const item = this.post;
        if (!item) {
            return 0;
        }

        return (item.upvoteCount ?? 0) - (item.downvoteCount ?? 0);
    }

    get isPostUpvoted(): boolean {
        return (this.post?.myVoteType ?? '').toLowerCase() === 'upvote';
    }

    get isPostDownvoted(): boolean {
        return (this.post?.myVoteType ?? '').toLowerCase() === 'downvote';
    }

    get canManagePost(): boolean {
        const item = this.post;
        const viewerId = this.session.profile?.id;
        return !!item && !!viewerId && item.authorId.toLowerCase() === viewerId.toLowerCase();
    }

    async togglePostUpvoteAsync(): Promise<void> {
        const item = this.post;
        if (!item || this.votingPost || !this.session.isAuthenticated()) {
            return;
        }

        const nextVote = this.isPostUpvoted ? undefined : 'Upvote';
        await this.votePostAsync(nextVote);
    }

    showPreviousPostImage(): void {
        if (!this.canMovePostImageBack) {
            return;
        }

        this.transitionToPostImage(this.postActiveImageIndex - 1, 'prev');
    }

    showNextPostImage(): void {
        if (!this.canMovePostImageForward) {
            return;
        }

        this.transitionToPostImage(this.postActiveImageIndex + 1, 'next');
    }

    onPostMediaCardClick(imageUrl: string): void {
        const mediaUrls = this.postMediaUrls;
        if (mediaUrls.length <= 1) {
            this.openImageFullscreen(imageUrl);
            return;
        }

        const nextIndex = this.postActiveImageIndex >= mediaUrls.length - 1
            ? 0
            : this.postActiveImageIndex + 1;

        this.transitionToPostImage(nextIndex, 'next');
    }

    setActivePostImage(index: number): void {
        const mediaUrls = this.postMediaUrls;
        if (index < 0 || index >= mediaUrls.length) {
            return;
        }

        const direction: 'next' | 'prev' = index > this.postActiveImageIndex ? 'next' : 'prev';
        this.transitionToPostImage(index, direction);
    }

    async togglePostDownvoteAsync(): Promise<void> {
        const item = this.post;
        if (!item || this.votingPost || !this.session.isAuthenticated()) {
            return;
        }

        const nextVote = this.isPostDownvoted ? undefined : 'Downvote';
        await this.votePostAsync(nextVote);
    }

    async votePollAsync(pollId: string, optionId: string): Promise<void> {
        const item = this.post;
        if (!item || this.votingPollId) {
            return;
        }

        this.votingPollId = pollId;
        this.error = '';

        try {
            const updatedPoll = await this.session.voteCommunityPollAsync(item.communityId, pollId, optionId);
            this.post = {
                ...item,
                poll: updatedPoll
            };
        } catch (error) {
            this.error = this.extractApiErrorMessage(error, 'Unable to vote on poll right now.');
        } finally {
            this.votingPollId = null;
            this.refreshView();
        }
    }

    async toggleSavePostAsync(): Promise<void> {
        const item = this.post;
        if (!item || this.togglingSavePost || !this.session.isAuthenticated()) {
            return;
        }

        this.togglingSavePost = true;
        this.error = '';
        try {
            if (item.isSavedByMe) {
                await this.session.unsaveCommunityPostAsync(item.communityId, item.id);
                this.post = { ...item, isSavedByMe: false };
            } else {
                const saved = await this.session.saveCommunityPostAsync(item.communityId, item.id);
                this.post = saved;
            }
        } catch {
            this.error = 'Unable to update saved state.';
        } finally {
            this.togglingSavePost = false;
            this.refreshView();
        }
    }

    editPostAsync(): void {
        const item = this.post;
        if (!item || !this.canManagePost || this.updatingPost) {
            return;
        }

        this.editPostModalOpen = true;
        this.error = '';
        this.refreshView();
    }

    closeEditPostModal(): void {
        if (this.updatingPost) {
            return;
        }

        this.editPostModalOpen = false;
        this.refreshView();
    }

    async submitPostEditAsync(payload: CommunityPostEditorSavePayload): Promise<void> {
        const item = this.post;
        if (!item || !this.canManagePost || this.updatingPost) {
            return;
        }

        this.updatingPost = true;
        this.error = '';
        try {
            const updated = await this.session.updateCommunityPostAsync(
                item.communityId,
                item.id,
                payload.title,
                payload.linkUrl,
                payload.content,
                payload.mediaContent,
                payload.imageUrls,
                payload.pollQuestion,
                payload.pollOptions,
                payload.clearPoll
            );
            this.post = this.normalizeSharedPost(updated);
            this.editPostModalOpen = false;
        } catch (error) {
            this.error = this.extractApiErrorMessage(error, 'Unable to update post right now.');
        } finally {
            this.updatingPost = false;
            this.refreshView();
        }
    }

    async deletePostAsync(): Promise<void> {
        const item = this.post;
        if (!item || !this.canManagePost || this.deletingPost) {
            return;
        }

        if (!confirm('Delete this post?')) {
            return;
        }

        this.deletingPost = true;
        this.error = '';
        try {
            await this.session.deleteCommunityPostAsync(item.communityId, item.id);
            this.post = null;
            this.notFound = true;
        } catch {
            this.error = 'Unable to delete post right now.';
        } finally {
            this.deletingPost = false;
            this.refreshView();
        }
    }

    private async votePostAsync(voteType?: 'Upvote' | 'Downvote'): Promise<void> {
        const item = this.post;
        if (!item) {
            return;
        }

        this.votingPost = true;
        this.error = '';
        try {
            const updated = await this.session.voteCommunityPostAsync(item.communityId, item.id, voteType);
            this.post = updated;
        } catch {
            this.error = 'Unable to vote on post right now.';
        } finally {
            this.votingPost = false;
            this.refreshView();
        }
    }

    async submitCommentAsync(): Promise<void> {
        const currentPost = this.post;
        if (!currentPost || this.postingComment || this.postingReply || !this.canCommentInCommunity) {
            if (this.isTimedOutInCommunity) {
                this.commentError = `You are timed out in this community until ${this.timedOutUntilText || 'later'}.`;
            }
            return;
        }

        const content = this.getTopCommentContent();
        if (!content) {
            return;
        }

        const signature = this.buildCommentSignature(currentPost.id, content);
        if (this.shouldSkipDuplicate(signature)) {
            return;
        }

        this.postingComment = true;
        this.commentError = '';
        this.pendingCommentSignatures.add(signature);

        try {
            const updated = await this.session.addCommunityPostCommentAsync(currentPost.communityId, currentPost.id, content);
            this.post = updated;
            this.clearCommentComposer();
            this.commentSearchQuery = '';
            this.recentCommentSignatures.set(signature, Date.now());
        } catch {
            this.commentError = 'Unable to post comment right now.';
        } finally {
            this.pendingCommentSignatures.delete(signature);
            this.postingComment = false;
            this.refreshView();
        }
    }

    async submitCommentContentAsync(content: string): Promise<void> {
        this.commentDraft = content;
        this.commentEditorMode = 'markdown';
        await this.submitCommentAsync();

        if (!this.commentError) {
            this.commentComposerResetToken += 1;
        }
    }

    onTopCommentEditorCancelled(): void {
        this.clearCommentComposer();
    }

    expandCommentComposer(): void {
        this.commentComposerExpanded = true;
    }

    clearCommentComposer(): void {
        if (this.postingComment) {
            return;
        }

        this.commentDraft = '';
        this.richCommentDraftHtml = '';
        this.commentError = '';
        this.commentComposerExpanded = false;
        this.resetRichCommandStates();
        if (this.commentEditorMode === 'rich' && this.richCommentEditor) {
            this.richCommentEditor.nativeElement.innerHTML = '';
        }
    }

    async toggleCommentEditorMode(): Promise<void> {
        if (this.commentEditorMode === 'markdown') {
            const markdown = this.commentDraft;
            this.commentEditorMode = 'rich';
            this.resetRichCommandStates();
            this.commentComposerExpanded = true;
            this.richCommentDraftHtml = this.markdownToRichHtml(markdown);
            this.refreshView();
            await Promise.resolve();
            if (this.richCommentEditor) {
                this.richCommentEditor.nativeElement.innerHTML = this.richCommentDraftHtml;
                this.richCommentEditor.nativeElement.focus();
                this.updateRichCommandStates();
            }
            return;
        }

        this.commentDraft = this.readRichCommentText();
        this.commentEditorMode = 'markdown';
        this.resetRichCommandStates();
        this.refreshView();
    }

    applyRichCommand(command: 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'formatBlock' | 'createLink' | 'spoiler'): void {
        if (this.commentEditorMode !== 'rich') {
            return;
        }

        if (command === 'spoiler') {
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) {
                return;
            }

            const editor = this.richCommentEditor?.nativeElement;
            if (!editor) {
                return;
            }

            const activeSpoiler = this.findActiveSpoilerNode(selection.anchorNode, editor);
            if (activeSpoiler && this.isSpoilerCommandActive) {
                this.unwrapSpoilerKeepingText(activeSpoiler, selection);
                this.updateRichCommandStates();
                this.refreshView();
                return;
            }

            const selectedText = selection.toString() ?? '';
            const hasSelectedText = selectedText.length > 0;
            const spoilerText = hasSelectedText ? selectedText : this.defaultSpoilerPlaceholder;
            const range = selection.getRangeAt(0);
            range.deleteContents();

            const spoiler = document.createElement('span');
            spoiler.className = 'compose-spoiler';
            spoiler.setAttribute('data-spoiler', 'true');
            spoiler.textContent = spoilerText;

            range.insertNode(spoiler);
            this.ensureSpaceAfterInlineNode(spoiler);
            if (hasSelectedText) {
                this.placeCaretAtEndOfNode(spoiler);
            } else {
                this.selectNodeContents(spoiler);
            }
            this.updateRichCommandStates();
            this.refreshView();
            return;
        }

        if (command === 'createLink') {
            const url = prompt('Enter URL');
            if (!url) {
                return;
            }

            document.execCommand('createLink', false, url.trim());
            this.refreshView();
            return;
        }

        if (command === 'formatBlock') {
            const selection = window.getSelection();
            const editor = this.richCommentEditor?.nativeElement;
            const activeQuote = selection && editor
                ? this.findAncestorTag(selection.anchorNode, editor, 'BLOCKQUOTE')
                : null;

            if (activeQuote) {
                this.unwrapQuoteKeepingText(activeQuote, selection);
                this.updateRichCommandStates();
                this.refreshView();
                return;
            }

            const usedAngleBrackets = document.execCommand('formatBlock', false, '<blockquote>');
            if (!usedAngleBrackets) {
                const usedPlainTag = document.execCommand('formatBlock', false, 'blockquote');
                if (!usedPlainTag) {
                    const selectedText = window.getSelection()?.toString().trim() ?? '';
                    const fallbackHtml = selectedText
                        ? `<blockquote>${selectedText}</blockquote>`
                        : '<blockquote><br></blockquote>';
                    document.execCommand('insertHTML', false, fallbackHtml);
                }
            }

            this.updateRichCommandStates();
            this.refreshView();
            return;
        }

        document.execCommand(command, false);
        this.updateRichCommandStates();
        this.refreshView();
    }

    openReplyComposer(commentId: string, authorHandle: string): void {
        if (this.postingReply || !this.canCommentInCommunity) {
            if (this.isTimedOutInCommunity) {
                this.replyError = `You are timed out in this community until ${this.timedOutUntilText || 'later'}.`;
            }
            return;
        }

        this.closeCommentMenu();

        if (this.activeReplyCommentId === commentId) {
            this.cancelReplyComposer();
            return;
        }

        this.activeReplyCommentId = commentId;
        this.activeEditCommentId = null;
        this.editCommentDraft = '';
        this.activeReplyHandle = authorHandle;
        this.replyDraft = `@${authorHandle} `;
        this.replyError = '';
    }

    cancelReplyComposer(): void {
        if (this.postingReply) {
            return;
        }

        this.activeReplyCommentId = null;
        this.activeReplyHandle = '';
        this.replyDraft = '';
        this.replyError = '';
    }

    canManageComment(comment: CommunityPostDto['comments'][number]): boolean {
        const viewerId = this.session.profile?.id?.toLowerCase() ?? '';
        return !!viewerId && comment.authorId.toLowerCase() === viewerId;
    }

    openEditComment(comment: CommunityPostDto['comments'][number]): void {
        if (!this.canManageComment(comment) || this.savingCommentEdit || this.deletingCommentId === comment.id) {
            return;
        }

        this.closeCommentMenu();

        if (this.activeEditCommentId === comment.id) {
            this.cancelEditComment();
            return;
        }

        this.activeReplyCommentId = null;
        this.replyDraft = '';
        this.replyError = '';
        this.commentActionError = '';
        this.activeEditCommentId = comment.id;
        this.editCommentDraft = comment.content;
    }

    cancelEditComment(): void {
        if (this.savingCommentEdit) {
            return;
        }

        this.activeEditCommentId = null;
        this.editCommentDraft = '';
        this.commentActionError = '';
    }

    async submitEditCommentAsync(commentId: string): Promise<void> {
        const currentPost = this.post;
        if (!currentPost || this.activeEditCommentId !== commentId || this.savingCommentEdit) {
            return;
        }

        const content = this.editCommentDraft.trim();
        if (!content) {
            this.commentActionError = 'Comment content is required.';
            return;
        }

        this.savingCommentEdit = true;
        this.commentActionError = '';
        try {
            const updated = await this.session.updateCommunityPostCommentAsync(currentPost.communityId, currentPost.id, commentId, content);
            this.post = updated;
            this.cancelEditComment();
        } catch {
            this.commentActionError = 'Unable to update comment right now.';
        } finally {
            this.savingCommentEdit = false;
            this.refreshView();
        }
    }

    async submitEditCommentContentAsync(commentId: string, content: string): Promise<void> {
        this.editCommentDraft = content;
        await this.submitEditCommentAsync(commentId);
    }

    async deleteCommentAsync(commentId: string): Promise<void> {
        const currentPost = this.post;
        if (!currentPost || this.deletingCommentId === commentId || this.savingCommentEdit) {
            return;
        }

        this.closeCommentMenu();

        const confirmed = confirm('Delete this comment?');
        if (!confirmed) {
            return;
        }

        this.deletingCommentId = commentId;
        this.commentActionError = '';
        try {
            const updated = await this.session.deleteCommunityPostCommentAsync(currentPost.communityId, currentPost.id, commentId);
            this.post = updated;
            if (this.activeEditCommentId === commentId) {
                this.cancelEditComment();
            }
        } catch {
            this.commentActionError = 'Unable to delete comment right now.';
        } finally {
            this.deletingCommentId = null;
            this.refreshView();
        }
    }

    async submitReplyAsync(commentId: string): Promise<void> {
        const currentPost = this.post;
        if (!currentPost || this.postingReply || this.activeReplyCommentId !== commentId || !this.canCommentInCommunity) {
            if (this.isTimedOutInCommunity) {
                this.replyError = `You are timed out in this community until ${this.timedOutUntilText || 'later'}.`;
            }
            return;
        }

        const content = this.replyDraft.trim();
        if (!content) {
            return;
        }

        const signature = this.buildCommentSignature(currentPost.id, content);
        if (this.shouldSkipDuplicate(signature)) {
            return;
        }

        this.postingReply = true;
        this.replyError = '';
        this.pendingCommentSignatures.add(signature);

        try {
            const updated = await this.session.addCommunityPostCommentAsync(currentPost.communityId, currentPost.id, content, commentId);
            this.post = updated;
            this.cancelReplyComposer();
            this.commentSearchQuery = '';
            this.recentCommentSignatures.set(signature, Date.now());
        } catch {
            this.replyError = 'Unable to post reply right now.';
        } finally {
            this.pendingCommentSignatures.delete(signature);
            this.postingReply = false;
            this.refreshView();
        }
    }

    async submitReplyContentAsync(commentId: string, content: string): Promise<void> {
        this.replyDraft = content;
        await this.submitReplyAsync(commentId);

        if (!this.replyError) {
            this.replyComposerResetToken += 1;
        }
    }

    toggleCommentMenu(commentId: string, event: MouseEvent): void {
        event.stopPropagation();
        this.openCommentMenuId = this.openCommentMenuId === commentId ? null : commentId;
    }

    closeCommentMenu(): void {
        this.openCommentMenuId = null;
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('.comment-menu-wrap')) {
            this.closeCommentMenu();
        }
    }

    @HostListener('document:keydown.escape')
    onDocumentEscape(): void {
        if (this.fullscreenImageUrl) {
            this.closeImageFullscreen();
            return;
        }

        this.closeCommentMenu();
    }

    @HostListener('document:keydown', ['$event'])
    onDocumentKeydown(event: KeyboardEvent): void {
        if (!this.fullscreenImageUrl) {
            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.showPreviousFullscreenImage();
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.showNextFullscreenImage();
        }
    }

    get visibleComments(): CommunityPostDto['comments'] {
        const comments = this.post?.comments ?? [];
        const expandedTerms = expandDiscoveryTerms(this.commentSearchQuery);
        const filtered = expandedTerms.length
            ? comments.filter(comment => this.commentSearchScore(comment, expandedTerms) > 0)
            : comments;

        return [...filtered].sort((a, b) => {
            const aScore = this.getCommentVoteScore(a.id);
            const bScore = this.getCommentVoteScore(b.id);
            const aTime = new Date(a.createdAtUtc).getTime();
            const bTime = new Date(b.createdAtUtc).getTime();

            switch (this.commentSort) {
                case 'top': {
                    const scoreDiff = bScore - aScore;
                    return scoreDiff !== 0 ? scoreDiff : bTime - aTime;
                }
                case 'new':
                    return bTime - aTime;
                case 'controversial': {
                    const conflictDiff = Math.abs(aScore) - Math.abs(bScore);
                    return conflictDiff !== 0 ? conflictDiff : bTime - aTime;
                }
                case 'old':
                    return aTime - bTime;
                case 'qna': {
                    const aQuestion = a.content.includes('?') ? 1 : 0;
                    const bQuestion = b.content.includes('?') ? 1 : 0;
                    if (aQuestion !== bQuestion) {
                        return bQuestion - aQuestion;
                    }

                    return bTime - aTime;
                }
                case 'best':
                default: {
                    const bestDiff = Math.abs(bScore) - Math.abs(aScore);
                    return bestDiff !== 0 ? bestDiff : bTime - aTime;
                }
            }
        });
    }

    private commentSearchScore(comment: CommunityPostDto['comments'][number], expandedTerms: ReadonlyArray<string>): number {
        return scoreDiscoveryFields(expandedTerms, [
            { value: comment.content, weight: 1.5 },
            { value: comment.authorHandle, weight: 1.0 }
        ]);
    }

    get threadedComments(): CommentThreadItem[] {
        const ordered = [...this.visibleComments].sort((a, b) =>
            new Date(a.createdAtUtc).getTime() - new Date(b.createdAtUtc).getTime());

        const roots: CommentThreadNode[] = [];
        const nodeById = new Map<string, CommentThreadNode>();
        const latestCommentIdByHandle = new Map<string, string>();

        for (const comment of ordered) {
            nodeById.set(comment.id, { comment, children: [] });
        }

        for (const comment of ordered) {
            const node = nodeById.get(comment.id);
            if (!node) {
                continue;
            }

            const explicitParentId = comment.parentCommentId?.trim() || null;
            const replyTarget = this.extractReplyTarget(comment.content);
            const inferredParentId = replyTarget ? latestCommentIdByHandle.get(replyTarget.toLowerCase()) : null;
            const parentId = explicitParentId ?? inferredParentId ?? null;
            const parent = parentId ? nodeById.get(parentId) : undefined;

            if (parent && parent.comment.id !== comment.id) {
                parent.children.push(node);
            } else {
                roots.push(node);
            }

            latestCommentIdByHandle.set(comment.authorHandle.toLowerCase(), comment.id);
        }

        const sortedRoots = [...roots].sort((a, b) => {
            const aScore = this.getCommentVoteScore(a.comment.id);
            const bScore = this.getCommentVoteScore(b.comment.id);
            const aTime = new Date(a.comment.createdAtUtc).getTime();
            const bTime = new Date(b.comment.createdAtUtc).getTime();

            switch (this.commentSort) {
                case 'top': {
                    const scoreDiff = bScore - aScore;
                    return scoreDiff !== 0 ? scoreDiff : bTime - aTime;
                }
                case 'new':
                    return bTime - aTime;
                case 'controversial': {
                    const conflictDiff = Math.abs(aScore) - Math.abs(bScore);
                    return conflictDiff !== 0 ? conflictDiff : bTime - aTime;
                }
                case 'old':
                    return aTime - bTime;
                case 'qna': {
                    const aQuestion = a.comment.content.includes('?') ? 1 : 0;
                    const bQuestion = b.comment.content.includes('?') ? 1 : 0;
                    if (aQuestion !== bQuestion) {
                        return bQuestion - aQuestion;
                    }

                    return bTime - aTime;
                }
                case 'best':
                default: {
                    const bestDiff = Math.abs(bScore) - Math.abs(aScore);
                    return bestDiff !== 0 ? bestDiff : bTime - aTime;
                }
            }
        });

        const flattened: CommentThreadItem[] = [];
        const flattenNode = (node: CommentThreadNode, level: number): void => {
            flattened.push({ comment: node.comment, level });

            const sortedChildren = [...node.children].sort((a, b) =>
                new Date(a.comment.createdAtUtc).getTime() - new Date(b.comment.createdAtUtc).getTime());

            for (const child of sortedChildren) {
                flattenNode(child, level + 1);
            }
        };

        for (const node of sortedRoots) {
            flattenNode(node, 0);
        }

        return flattened;
    }

    toggleCommentUpvote(commentId: string): void {
        const current = this.commentVoteById.get(commentId) ?? 0;
        this.commentVoteById.set(commentId, current === 1 ? 0 : 1);
    }

    toggleCommentDownvote(commentId: string): void {
        const current = this.commentVoteById.get(commentId) ?? 0;
        this.commentVoteById.set(commentId, current === -1 ? 0 : -1);
    }

    isCommentUpvoted(commentId: string): boolean {
        return (this.commentVoteById.get(commentId) ?? 0) === 1;
    }

    isCommentDownvoted(commentId: string): boolean {
        return (this.commentVoteById.get(commentId) ?? 0) === -1;
    }

    getCommentVoteScore(commentId: string): number {
        return this.commentVoteById.get(commentId) ?? 0;
    }

    formatCommentContent(content: string): string {
        const containsHtml = /<\/?[a-z][\s\S]*>/i.test(content);
        if (containsHtml) {
            return content.replace(/\|\|([\s\S]+?)\|\|/g, (_match, spoilerText) =>
                `<span class="comment-spoiler" role="button" tabindex="0" aria-label="Spoiler text. Click to reveal." aria-pressed="false">${this.escapeHtml(spoilerText)}</span>`);
        }

        const escaped = this.escapeHtml(content);
        const withSpoilers = escaped.replace(/\|\|([\s\S]+?)\|\|/g, (_match, spoilerText) =>
            `<span class="comment-spoiler" role="button" tabindex="0" aria-label="Spoiler text. Click to reveal." aria-pressed="false">${spoilerText}</span>`);

        return withSpoilers.replace(/\n/g, '<br>');
    }

    onCommentContentClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const spoiler = target?.closest('.comment-spoiler') as HTMLElement | null;
        if (!spoiler) {
            return;
        }

        spoiler.classList.toggle('revealed');
        spoiler.setAttribute('aria-pressed', spoiler.classList.contains('revealed') ? 'true' : 'false');
        event.stopPropagation();
    }

    onCommentContentKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (!target || !target.classList.contains('comment-spoiler')) {
            return;
        }

        event.preventDefault();
        target.classList.toggle('revealed');
        target.setAttribute('aria-pressed', target.classList.contains('revealed') ? 'true' : 'false');
    }

    onRichEditorKeydown(event: KeyboardEvent): void {
        if (this.commentEditorMode !== 'rich') {
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            // Some contenteditable engines occasionally skip input events for delete operations.
            setTimeout(() => this.cleanupEmptyComposeSpoilers(), 0);
        }

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || !selection.isCollapsed) {
            return;
        }

        const editor = this.richCommentEditor?.nativeElement;
        if (!editor) {
            return;
        }

        const spoiler = this.findAncestorWithClass(selection.anchorNode, editor, 'compose-spoiler');
        if (spoiler && this.isSpoilerEffectivelyEmpty(spoiler) && this.isPlainTypingKey(event)) {
            event.preventDefault();
            this.unwrapEmptySpoilerAndInsertText(spoiler, event.key);
            return;
        }

        if (spoiler && this.isCaretAtEndOfNode(selection, spoiler)) {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                this.placeCaretAfterInlineNode(spoiler);
                this.updateRichCommandStates();
                return;
            }
        }

        if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') {
            return;
        }

        const quote = this.findAncestorTag(selection.anchorNode, editor, 'BLOCKQUOTE');
        if (!quote || !this.isCaretAtEndOfNode(selection, quote)) {
            return;
        }

        const exitPoint = this.ensureExitPointAfterNode(quote, editor);
        if (!exitPoint) {
            return;
        }

        event.preventDefault();
        this.placeCaretAtStart(exitPoint);
    }

    onRichEditorInput(): void {
        this.normalizeComposeSpoilerSpans();
        this.cleanupEmptyComposeSpoilers();
        this.updateRichCommandStates();
    }

    onRichEditorFocus(): void {
        this.updateRichCommandStates();
    }

    onRichEditorKeyup(): void {
        this.updateRichCommandStates();
    }

    onRichEditorMouseup(): void {
        setTimeout(() => this.updateRichCommandStates(), 0);
    }

    onRichToolbarMouseDown(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('button')) {
            return;
        }

        // Keep the contenteditable selection intact when clicking toolbar buttons.
        event.preventDefault();
        this.richCommentEditor?.nativeElement.focus();
    }

    onRichToolbarPointerDown(event: PointerEvent): void {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('button')) {
            return;
        }

        // Touch/pen can route through pointer events; keep caret in editor for command execution.
        event.preventDefault();
        this.richCommentEditor?.nativeElement.focus();
    }

    onRichEditorMousedown(event: MouseEvent): void {
        if (this.commentEditorMode !== 'rich') {
            return;
        }

        const editor = this.richCommentEditor?.nativeElement;
        if (!editor || event.target !== editor) {
            return;
        }

        const lastElement = editor.lastElementChild;
        if (!lastElement || lastElement.tagName !== 'BLOCKQUOTE') {
            return;
        }

        const exitPoint = this.ensureExitPointAfterNode(lastElement, editor);
        if (!exitPoint) {
            return;
        }

        event.preventDefault();
        this.placeCaretAtStart(exitPoint);
        this.updateRichCommandStates();
    }

    async copyCommentLinkAsync(commentId: string): Promise<void> {
        const postId = this.post?.id;
        if (!postId) {
            return;
        }

        const link = `${window.location.origin}/cp/${postId}#comment-${commentId}`;
        const copied = await this.copyTextToClipboardAsync(link);
        if (!copied) {
            return;
        }

        this.copiedCommentId = commentId;
        if (this.copiedCommentTimeoutId) {
            clearTimeout(this.copiedCommentTimeoutId);
        }

        this.copiedCommentTimeoutId = setTimeout(() => {
            this.copiedCommentId = null;
            this.copiedCommentTimeoutId = null;
            this.refreshView();
        }, 1500);

        this.refreshView();
    }

    openImageFullscreen(imageUrl: string): void {
        const mediaUrls = this.postMediaUrls;
        if (!mediaUrls.length) {
            this.fullscreenImageUrl = imageUrl;
            this.fullscreenImageIndex = 0;
            return;
        }

        const clickedIndex = mediaUrls.findIndex(url => url === imageUrl);
        this.fullscreenImageIndex = clickedIndex >= 0 ? clickedIndex : this.postActiveImageIndex;
        this.fullscreenImageUrl = mediaUrls[this.fullscreenImageIndex] ?? imageUrl;
    }

    get canMoveFullscreenImageBack(): boolean {
        return this.fullscreenImageIndex > 0;
    }

    get canMoveFullscreenImageForward(): boolean {
        return this.fullscreenImageIndex < this.postMediaUrls.length - 1;
    }

    showPreviousFullscreenImage(): void {
        if (!this.canMoveFullscreenImageBack) {
            return;
        }

        this.fullscreenImageIndex -= 1;
        this.fullscreenImageUrl = this.postMediaUrls[this.fullscreenImageIndex] ?? this.fullscreenImageUrl;
    }

    showNextFullscreenImage(): void {
        if (!this.canMoveFullscreenImageForward) {
            return;
        }

        this.fullscreenImageIndex += 1;
        this.fullscreenImageUrl = this.postMediaUrls[this.fullscreenImageIndex] ?? this.fullscreenImageUrl;
    }

    closeImageFullscreen(): void {
        this.fullscreenImageUrl = null;
        this.fullscreenImageIndex = 0;
        this.refreshView();
    }

    trackByCommentId(_index: number, comment: CommunityPostDto['comments'][number]): string {
        return comment.id;
    }

    trackByThreadCommentId(_index: number, item: CommentThreadItem): string {
        return item.comment.id;
    }

    trackByMediaUrl(_index: number, mediaUrl: string): string {
        return mediaUrl;
    }

    private get currentViewerMembership(): CommunityDto['members'][number] | null {
        const viewerProfileId = this.session.profile?.id;
        if (!viewerProfileId) {
            return null;
        }

        return this.community?.members.find(member => member.profileId.toLowerCase() === viewerProfileId.toLowerCase()) ?? null;
    }

    private async loadAsync(postId: string): Promise<void> {
        this.loading = true;
        this.notFound = false;
        this.error = '';
        this.post = null;
        this.community = null;
        this.postActiveImageIndex = 0;
        this.postImageSlideDirection = 'next';
        this.postOutgoingImageUrl = null;
        this.postImageAnimating = false;
        if (this.postImageAnimationTimeoutId) {
            clearTimeout(this.postImageAnimationTimeoutId);
            this.postImageAnimationTimeoutId = null;
        }
        this.commentDraft = '';
        this.richCommentDraftHtml = '';
        this.commentError = '';
        this.commentSearchQuery = '';
        this.cancelReplyComposer();
        this.cancelEditComment();
        this.deletingCommentId = null;
        this.commentActionError = '';
        this.commentVoteById.clear();
        this.pendingCommentSignatures.clear();

        if (!postId) {
            this.notFound = true;
            this.loading = false;
            return;
        }

        try {
            const loadedPost = await firstValueFrom(this.api.getSharedCommunityPost(postId));
            this.post = this.normalizeSharedPost(loadedPost);
            this.postActiveImageIndex = 0;
            this.postImageSlideDirection = 'next';
            this.postOutgoingImageUrl = null;
            this.postImageAnimating = false;

            try {
                this.community = await firstValueFrom(this.api.getCommunityById(loadedPost.communityId, 1000));
            } catch {
                this.community = null;
            }
        } catch (error: any) {
            if (error?.status === 404) {
                this.notFound = true;
            } else {
                this.error = 'Could not load this shared community post.';
            }
        } finally {
            this.loading = false;
            this.refreshView();
        }
    }

    private getTopCommentContent(): string {
        if (this.commentEditorMode === 'markdown') {
            return this.commentDraft.trim();
        }

        const serialized = this.readRichCommentContent();
        return this.hasMeaningfulSerializedContent(serialized) ? serialized : '';
    }

    private hasMeaningfulSerializedContent(serialized: string): boolean {
        if (!serialized.trim()) {
            return false;
        }

        const probe = document.createElement('div');
        probe.innerHTML = serialized;
        const text = (probe.textContent ?? '')
            .replace(/\u00A0/g, ' ')
            .replace(/\u200B/g, '')
            .trim();

        return text.length > 0;
    }

    private readRichCommentContent(): string {
        const source = this.richCommentEditor?.nativeElement;
        if (!source) {
            return '';
        }

        const working = document.createElement('div');
        working.innerHTML = source.innerHTML;

        const markerNodes = working.querySelectorAll('span[data-caret-marker="true"]');
        for (const marker of markerNodes) {
            marker.remove();
        }

        const spoilerNodes = working.querySelectorAll('span');
        for (const node of spoilerNodes) {
            if (!(node instanceof HTMLElement) || !this.isSpoilerLikeElement(node)) {
                continue;
            }

            const text = (node.textContent ?? '').trim();
            const replacement = document.createTextNode(text ? `||${text}||` : '');
            node.parentNode?.replaceChild(replacement, node);
        }

        return working.innerHTML.trim();
    }

    private readRichCommentText(): string {
        const source = this.richCommentEditor?.nativeElement;
        if (!source) {
            return '';
        }

        // Preserve spoiler intent when leaving rich mode or submitting by converting spoiler spans back to ||text||.
        const working = document.createElement('div');
        working.innerHTML = source.innerHTML;
        const spoilerNodes = working.querySelectorAll('span');
        for (const node of spoilerNodes) {
            if (!(node instanceof HTMLElement) || !this.isSpoilerLikeElement(node)) {
                continue;
            }

            const text = (node.textContent ?? '').trim();
            const replacement = document.createTextNode(text ? `||${text}||` : '');
            node.parentNode?.replaceChild(replacement, node);
        }

        const raw = working.innerText ?? '';
        return raw
            .replace(/\u200B/g, '')
            .replace(/\u00A0/g, ' ')
            .replace(/\r/g, '')
            .trim();
    }

    private markdownToRichHtml(markdown: string): string {
        const escaped = markdown
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const withSpoilers = escaped.replace(/\|\|([\s\S]+?)\|\|/g, (_match, spoilerText) =>
            `<span class="compose-spoiler" data-spoiler="true">${spoilerText}</span>`);

        return withSpoilers.replace(/\n/g, '<br>');
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private findAncestorTag(node: Node | null, boundary: HTMLElement, tagName: string): HTMLElement | null {
        let cursor: Node | null = node;
        while (cursor && cursor !== boundary) {
            if (cursor instanceof HTMLElement && cursor.tagName === tagName) {
                return cursor;
            }

            cursor = cursor.parentNode;
        }

        return null;
    }

    private findAncestorWithClass(node: Node | null, boundary: HTMLElement, className: string): HTMLElement | null {
        let cursor: Node | null = node;
        while (cursor && cursor !== boundary) {
            if (cursor instanceof HTMLElement && cursor.classList.contains(className)) {
                return cursor;
            }

            cursor = cursor.parentNode;
        }

        return null;
    }

    private isCaretAtEndOfNode(selection: Selection, node: Node): boolean {
        if (!selection.rangeCount) {
            return false;
        }

        const caret = selection.getRangeAt(0);
        const end = document.createRange();
        end.selectNodeContents(node);
        end.collapse(false);

        return caret.compareBoundaryPoints(Range.START_TO_START, end) === 0
            && caret.compareBoundaryPoints(Range.END_TO_END, end) === 0;
    }

    private ensureExitPointAfterNode(node: Element, editor: HTMLElement): HTMLElement | null {
        let next = node.nextElementSibling as HTMLElement | null;
        while (next && next.tagName === 'BLOCKQUOTE') {
            next = next.nextElementSibling as HTMLElement | null;
        }

        if (next) {
            return next;
        }

        const paragraph = document.createElement('p');
        paragraph.appendChild(document.createElement('br'));
        editor.insertBefore(paragraph, node.nextSibling);
        return paragraph;
    }

    private placeCaretAtStart(node: HTMLElement): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richCommentEditor?.nativeElement.focus();
        const range = document.createRange();
        range.setStart(node, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private placeCaretAfterNode(node: Node): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richCommentEditor?.nativeElement.focus();
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private placeCaretAfterInlineNode(node: Node): Text | null {
        const anchor = this.ensureTextAnchorAfterInlineNode(node);
        if (!anchor) {
            return null;
        }

        const offset = anchor.textContent?.length ?? 0;
        this.placeCaretAtTextOffset(anchor, offset);
        return anchor;
    }

    private ensureTextAnchorAfterInlineNode(node: Node): Text | null {
        const parent = node.parentNode;
        if (!parent) {
            return null;
        }

        const next = node.nextSibling;
        if (next instanceof Text) {
            return next;
        }

        const anchor = document.createTextNode('');
        parent.insertBefore(anchor, next);
        return anchor;
    }

    private ensureSpaceAfterInlineNode(node: Node): Text | null {
        const anchor = this.ensureTextAnchorAfterInlineNode(node);
        if (!anchor) {
            return null;
        }

        if (!anchor.textContent || anchor.textContent.length === 0) {
            anchor.textContent = '\u00A0';
            return anchor;
        }

        return anchor;
    }

    private isPlainTypingKey(event: KeyboardEvent): boolean {
        return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    }

    private isSpoilerEffectivelyEmpty(spoiler: HTMLElement): boolean {
        const value = (spoiler.textContent ?? '')
            .replace(/\uFEFF/g, '')
            .replace(/\u2060/g, '')
            .replace(/\u00A0/g, '')
            .replace(/\u200B/g, '')
            .trim();
        return value.length === 0;
    }

    private cleanupEmptyComposeSpoilers(): void {
        if (this.commentEditorMode !== 'rich') {
            return;
        }

        const editor = this.richCommentEditor?.nativeElement;
        if (!editor) {
            return;
        }

        const selection = window.getSelection();
        const activeNode = selection?.anchorNode ?? null;
        const spoilerNodes = Array.from(editor.querySelectorAll('span'));

        for (const spoilerNode of spoilerNodes) {
            if (!(spoilerNode instanceof HTMLElement) || !this.isSpoilerLikeElement(spoilerNode) || !this.isSpoilerEffectivelyEmpty(spoilerNode)) {
                continue;
            }

            const wasActive = !!activeNode && spoilerNode.contains(activeNode);
            const anchor = this.ensureTextAnchorAfterInlineNode(spoilerNode);
            spoilerNode.remove();

            if (wasActive && anchor) {
                this.placeCaretAtTextOffset(anchor, 0);
            }
        }
    }

    private normalizeComposeSpoilerSpans(): void {
        const editor = this.richCommentEditor?.nativeElement;
        if (!editor) {
            return;
        }

        const spans = Array.from(editor.querySelectorAll('span'));
        for (const span of spans) {
            if (!(span instanceof HTMLElement) || !this.isSpoilerLikeElement(span)) {
                continue;
            }

            span.classList.add('compose-spoiler');
            span.setAttribute('data-spoiler', 'true');
            span.style.backgroundColor = '';
        }
    }

    private isSpoilerLikeElement(element: HTMLElement): boolean {
        if (element.classList.contains('compose-spoiler')) {
            return true;
        }

        if (element.getAttribute('data-spoiler') === 'true') {
            return true;
        }

        const inlineBg = (element.style.backgroundColor || '').replace(/\s+/g, '').toLowerCase();
        return inlineBg === 'rgb(183,192,203)' || inlineBg === '#b7c0cb' || inlineBg === 'rgba(183,192,203,1)';
    }

    private findActiveSpoilerNode(node: Node | null, boundary: HTMLElement): HTMLElement | null {
        let cursor: Node | null = node;
        while (cursor && cursor !== boundary) {
            if (cursor instanceof HTMLElement && this.isSpoilerLikeElement(cursor)) {
                return cursor;
            }

            cursor = cursor.parentNode;
        }

        return null;
    }

    private unwrapEmptySpoilerAndInsertText(spoiler: HTMLElement, text: string): void {
        const anchor = this.ensureTextAnchorAfterInlineNode(spoiler);
        spoiler.remove();

        if (!anchor) {
            document.execCommand('insertText', false, text);
            return;
        }

        anchor.insertData(0, text);
        this.placeCaretAtTextOffset(anchor, text.length);
    }

    private unwrapSpoilerKeepingText(spoiler: HTMLElement, selection: Selection): void {
        const text = spoiler.textContent ?? '';
        if (text === this.defaultSpoilerPlaceholder) {
            const anchor = this.ensureTextAnchorAfterInlineNode(spoiler);
            spoiler.remove();

            if (!anchor) {
                return;
            }

            if (anchor.textContent?.startsWith('\u00A0')) {
                anchor.deleteData(0, 1);
            }

            this.placeCaretAtTextOffset(anchor, 0);
            return;
        }

        const parent = spoiler.parentNode;
        if (!parent) {
            return;
        }

        const caretOffset = this.getSelectionOffsetInsideNode(selection, spoiler);
        const replacement = document.createTextNode(text);
        parent.replaceChild(replacement, spoiler);

        this.placeCaretAtTextOffset(replacement, Math.min(caretOffset, replacement.length));
    }

    private unwrapQuoteKeepingText(quote: HTMLElement, selection: Selection | null): void {
        const parent = quote.parentNode;
        if (!parent) {
            return;
        }

        let marker: HTMLElement | null = null;
        if (selection?.rangeCount && selection.anchorNode && quote.contains(selection.anchorNode)) {
            marker = document.createElement('span');
            marker.setAttribute('data-caret-marker', 'true');
            marker.style.display = 'inline-block';
            marker.style.width = '0';
            marker.style.overflow = 'hidden';

            const markerRange = selection.getRangeAt(0).cloneRange();
            markerRange.collapse(true);
            markerRange.insertNode(marker);
        }

        const fragment = document.createDocumentFragment();
        while (quote.firstChild) {
            fragment.appendChild(quote.firstChild);
        }

        parent.replaceChild(fragment, quote);

        if (!marker) {
            return;
        }

        const activeSelection = window.getSelection();
        if (!activeSelection || !marker.parentNode) {
            marker.remove();
            return;
        }

        const range = document.createRange();
        range.setStartBefore(marker);
        range.collapse(true);
        activeSelection.removeAllRanges();
        activeSelection.addRange(range);
        marker.remove();
    }

    private getSelectionOffsetInsideNode(selection: Selection, node: Node): number {
        if (!selection.rangeCount || !selection.isCollapsed) {
            return node.textContent?.length ?? 0;
        }

        const range = selection.getRangeAt(0).cloneRange();
        const probe = document.createRange();
        probe.selectNodeContents(node);
        probe.setEnd(range.endContainer, range.endOffset);
        return probe.toString().length;
    }

    private updateRichCommandStates(): void {
        if (this.commentEditorMode !== 'rich') {
            this.resetRichCommandStates();
            return;
        }

        const editor = this.richCommentEditor?.nativeElement;
        const selection = window.getSelection();
        if (!editor || !selection || !selection.rangeCount) {
            this.resetRichCommandStates();
            return;
        }

        const anchorNode = selection.anchorNode;
        if (!anchorNode || !editor.contains(anchorNode)) {
            this.resetRichCommandStates();
            return;
        }

        this.isBoldCommandActive = this.queryCommandStateSafe('bold');
        this.isItalicCommandActive = this.queryCommandStateSafe('italic');
        this.isUnorderedListCommandActive = this.queryCommandStateSafe('insertUnorderedList');
        this.isOrderedListCommandActive = this.queryCommandStateSafe('insertOrderedList');
        this.isLinkCommandActive = !!this.findAncestorTag(anchorNode, editor, 'A');
        this.isQuoteCommandActive = !!this.findAncestorTag(anchorNode, editor, 'BLOCKQUOTE');
        this.isSpoilerCommandActive = !!this.findActiveSpoilerNode(anchorNode, editor);
    }

    private queryCommandStateSafe(command: string): boolean {
        try {
            return !!document.queryCommandState(command);
        } catch {
            return false;
        }
    }

    private resetRichCommandStates(): void {
        this.isBoldCommandActive = false;
        this.isItalicCommandActive = false;
        this.isLinkCommandActive = false;
        this.isUnorderedListCommandActive = false;
        this.isOrderedListCommandActive = false;
        this.isQuoteCommandActive = false;
        this.isSpoilerCommandActive = false;
    }

    private placeCaretAtEndOfNode(node: Node): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richCommentEditor?.nativeElement.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private selectNodeContents(node: Node): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richCommentEditor?.nativeElement.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private placeCaretAtTextOffset(textNode: Text, offset: number): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richCommentEditor?.nativeElement.focus();
        const range = document.createRange();
        range.setStart(textNode, Math.max(0, Math.min(offset, textNode.length)));
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private refreshView(): void {
        this.ngZone.run(() => this.cdr.detectChanges());
    }

    private extractApiErrorMessage(error: unknown, fallback: string): string {
        if (typeof error === 'object' && error !== null) {
            const err = error as { error?: { message?: string }; message?: string };
            const apiMessage = err.error?.message?.trim();
            if (apiMessage) {
                return apiMessage;
            }

            const topMessage = err.message?.trim();
            if (topMessage) {
                return topMessage;
            }
        }

        return fallback;
    }

    private transitionToPostImage(nextIndex: number, direction: 'next' | 'prev'): void {
        const mediaUrls = this.postMediaUrls;
        if (!mediaUrls.length) {
            return;
        }

        const safeNextIndex = Math.min(Math.max(nextIndex, 0), mediaUrls.length - 1);
        if (safeNextIndex === this.postActiveImageIndex) {
            return;
        }

        const currentUrl = this.activePostMediaUrl;
        this.postImageSlideDirection = direction;

        if (!currentUrl) {
            this.postActiveImageIndex = safeNextIndex;
            return;
        }

        if (this.postImageAnimationTimeoutId) {
            clearTimeout(this.postImageAnimationTimeoutId);
            this.postImageAnimationTimeoutId = null;
        }

        this.postOutgoingImageUrl = currentUrl;
        this.postImageAnimating = true;
        this.postActiveImageIndex = safeNextIndex;

        this.postImageAnimationTimeoutId = setTimeout(() => {
            this.postImageAnimating = false;
            this.postOutgoingImageUrl = null;
            this.postImageAnimationTimeoutId = null;
            this.refreshView();
        }, this.postImageAnimationMs);

        this.refreshView();
    }

    private normalizeSharedPost(post: CommunityPostDto): CommunityPostDto {
        const normalizedImageUrls = (post.imageUrls ?? [])
            .map(url => this.normalizeMediaUrl(url))
            .filter((url): url is string => !!url);

        const normalizedPrimaryImage = this.normalizeMediaUrl(post.imageUrl);

        return {
            ...post,
            authorImageUrl: this.normalizeMediaUrl(post.authorImageUrl),
            imageUrl: normalizedPrimaryImage ?? normalizedImageUrls[0],
            imageUrls: normalizedImageUrls,
            comments: (post.comments ?? []).map(comment => ({
                ...comment,
                authorImageUrl: this.normalizeMediaUrl(comment.authorImageUrl)
            }))
        };
    }

    private normalizeMediaUrl(value?: string | null): string | undefined {
        const trimmed = value?.trim();
        if (!trimmed) {
            return undefined;
        }

        if (trimmed.startsWith('data:')) {
            return trimmed;
        }

        if (trimmed.startsWith('/')) {
            return this.apiOrigin ? `${this.apiOrigin}${trimmed}` : trimmed;
        }

        if (!/^https?:\/\//i.test(trimmed)) {
            if (this.apiOrigin) {
                const normalizedRelative = trimmed.replace(/^\/+/, '');
                return `${this.apiOrigin}/${normalizedRelative}`;
            }

            return trimmed;
        }

        try {
            const parsed = new URL(trimmed);
            if (this.apiOrigin && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0')) {
                return `${this.apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }

            return parsed.toString();
        } catch {
            return trimmed;
        }
    }

    private resolveApiOrigin(): string {
        try {
            return new URL(environment.apiBaseUrl).origin;
        } catch {
            return '';
        }
    }

    private shouldSkipDuplicate(signature: string): boolean {
        if (this.pendingCommentSignatures.has(signature)) {
            return true;
        }

        const lastTime = this.recentCommentSignatures.get(signature);
        if (!lastTime) {
            return false;
        }

        return Date.now() - lastTime < 10000;
    }

    private buildCommentSignature(postId: string, content: string): string {
        return `${postId}:${content.toLowerCase()}`;
    }

    private extractReplyTarget(content: string): string | null {
        const match = content.trim().match(/^@([a-zA-Z0-9._-]+)/);
        return match?.[1] ?? null;
    }

    private async copyTextToClipboardAsync(text: string): Promise<boolean> {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch {
        }

        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', 'true');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';

        document.body.appendChild(input);
        input.focus();
        input.select();

        try {
            return document.execCommand('copy');
        } finally {
            document.body.removeChild(input);
        }
    }
}
