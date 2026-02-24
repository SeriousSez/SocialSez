import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnDestroy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { PostDto, ProfileActivitySummaryDto, ProfileDto, ReelDto, StoryDto, StoryGroupDto } from '../../core/api.types';
import { buildSharedPostMarker, buildSharedPostPreview } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { PostComposerComponent } from '../../shared/post-composer/post-composer.component';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { FeedReelsListComponent, ReelCommentCreateEvent, ReelCommentDeleteEvent, ReelCommentUpdateEvent } from '../feed-page/feed-reels-list.component';
import { FeedStoryViewerComponent } from '../feed-page/feed-story-viewer.component';
import { ReelComposerModalComponent } from '../../shared/reel-composer-modal/reel-composer-modal.component';

@Component({
    selector: 'app-profile-page',
    standalone: true,
    imports: [CommonModule, RouterLink, ConfirmModalComponent, PostCardComponent, PostComposerComponent, SharePostModalComponent, SharePostMessageModalComponent, SkeletonComponent, FeedReelsListComponent, FeedStoryViewerComponent, ReelComposerModalComponent],
    templateUrl: './profile-page.component.html',
    styleUrl: './profile-page.component.scss'
})
export class ProfilePageComponent implements OnDestroy {
    activeTab: 'posts' | 'reels' = 'posts';
    posts: PostDto[] = [];
    reels: ReelDto[] = [];
    loading = true;
    error = '';
    avatarImageUrl = '';
    editingPostId: string | null = null;
    editContent = '';
    savingPost = false;
    deletingPostId: string | null = null;
    pendingDeletePostId: string | null = null;
    reactingPostId: string | null = null;
    reactingReelId: string | null = null;
    commentingReelId: string | null = null;
    updatingReelId: string | null = null;
    deletingReelId: string | null = null;
    pendingDeleteReelId: string | null = null;
    deletingReelCommentId: string | null = null;
    pendingDeleteReelComment: { reelId: string; commentId: string } | null = null;
    showComposer = false;
    showStoryComposer = false;
    showReelComposer = false;
    storyMediaFile: File | null = null;
    storyMediaPreviewUrl = '';
    storyComposerError = '';
    postingStory = false;
    sharingPostId: string | null = null;
    pendingSharePost: PostDto | null = null;
    pendingShareTarget: 'feed' | 'chat' | null = null;
    shareNote = '';
    viewedProfile: ProfileDto | null = null;
    viewedHandle: string | null = null;
    followState: 'idle' | 'loading' | 'success' | 'failure' = 'idle';
    isFollowing = false;
    isRequested = false;
    followRequiresApproval = false;
    viewedProfileHasActiveStory = false;
    viewedProfileHasUnseenStory = false;
    activeStoryGroup: StoryGroupDto | null = null;
    activeStoryIndex = 0;
    storyViewerError = '';
    sendingStoryReply = false;
    sharingStoryMessage = false;
    activitySummary: ProfileActivitySummaryDto | null = null;
    private loadInFlight = false;
    private reloadQueued = false;
    private followStateResetTimerId: number | null = null;
    private readonly likedStoryIds = new Set<string>();
    private storyMediaObjectUrl = '';
    private markingStoryId: string | null = null;
    private readonly destroyRef = inject(DestroyRef);

    constructor(public readonly session: SessionService, private readonly route: ActivatedRoute, private readonly router: Router) {
        this.session.appChanges$
            .pipe(
                filter(change => change === 'posts' || change === 'profile' || change === 'session'),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                void this.load();
            });

        this.route.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const rawHandle = params.get('handle');
                this.viewedHandle = rawHandle ? rawHandle.trim().toLowerCase() : null;
                void this.load();
            });

        void this.load();
    }

    get profile(): ProfileDto | null {
        return this.viewedProfile;
    }

    get currentProfileId(): string | null {
        return this.session.profile?.id ?? null;
    }

    get isOwnProfile(): boolean {
        if (!this.viewedProfile || !this.currentProfileId) {
            return false;
        }

        return this.viewedProfile.id === this.currentProfileId;
    }

    get followButtonLabel(): string {
        if (this.followState === 'loading') {
            return 'Working...';
        }

        if (this.followState === 'success') {
            if (this.isRequested) {
                return 'Request Sent';
            }

            return this.isFollowing ? 'Following' : 'Unfollowed';
        }

        if (this.followState === 'failure') {
            return 'Try again';
        }

        if (this.isRequested) {
            return 'Cancel Request';
        }

        return this.isFollowing ? 'Unfollow' : 'Follow';
    }

    get isPrivateLockedView(): boolean {
        return !!this.viewedProfile
            && !this.isOwnProfile
            && this.viewedProfile.isPrivate
            && !this.isFollowing;
    }

    get totalPosts(): number {
        return this.activitySummary?.postCount ?? this.posts.length;
    }

    get totalReels(): number {
        return this.reels.length;
    }

    get totalCommentsOnPosts(): number {
        return this.activitySummary?.commentCountOnPosts
            ?? this.posts.reduce((sum, post) => sum + post.comments.length, 0);
    }

    get activeLast7Days(): number {
        if (this.activitySummary) {
            return this.activitySummary.activeLast7Days;
        }

        const weekAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
        return this.posts.filter(post => Date.parse(post.createdAtUtc) >= weekAgoMs).length;
    }

    get activeStoryAuthorHandles(): string[] {
        const handle = this.viewedProfile?.handle?.trim().toLowerCase();
        if (!handle || !this.viewedProfileHasActiveStory) {
            return [];
        }

        return [handle];
    }

    get activeUnseenStoryAuthorHandles(): string[] {
        const handle = this.viewedProfile?.handle?.trim().toLowerCase();
        if (!handle || !this.viewedProfileHasActiveStory || !this.viewedProfileHasUnseenStory) {
            return [];
        }

        return [handle];
    }

    get currentProfileHandle(): string | null {
        return this.viewedProfile?.handle?.trim().toLowerCase() ?? null;
    }

    get activeStory(): StoryDto | null {
        if (!this.activeStoryGroup) {
            return null;
        }

        return this.activeStoryGroup.stories[this.activeStoryIndex] ?? null;
    }

    get hasPreviousStory(): boolean {
        return this.activeStoryIndex > 0;
    }

    get hasNextStory(): boolean {
        return !!this.activeStoryGroup && this.activeStoryIndex < this.activeStoryGroup.stories.length - 1;
    }

    setActiveTab(tab: 'posts' | 'reels'): void {
        this.activeTab = tab;
    }

    openComposer(): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.showStoryComposer = false;
        this.showReelComposer = false;
        this.showComposer = true;
    }

    openStoryComposer(): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.showComposer = false;
        this.showReelComposer = false;
        this.showStoryComposer = true;
        this.storyComposerError = '';
    }

    openReelComposer(): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.showComposer = false;
        this.showStoryComposer = false;
        this.showReelComposer = true;
    }

    onReelComposerClosed(): void {
        this.showReelComposer = false;
    }

    onReelComposerPublished(): void {
        this.activeTab = 'reels';
        void this.load();
    }

    onPostComposerBackdropClick(event: MouseEvent): void {
        if (event.target !== event.currentTarget) {
            return;
        }

        this.onComposerCanceled();
    }

    onStoryComposerBackdropClick(event: MouseEvent): void {
        if (event.target !== event.currentTarget || this.postingStory) {
            return;
        }

        this.cancelStoryComposer();
    }

    onComposerCanceled(): void {
        this.showComposer = false;
    }

    async onComposerPosted(): Promise<void> {
        this.showComposer = false;
        await this.load();
    }

    cancelStoryComposer(): void {
        if (this.postingStory) {
            return;
        }

        this.showStoryComposer = false;
        this.storyComposerError = '';
        this.clearStoryMediaSelection();
    }

    async onStoryMediaSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;

        this.clearStoryMediaSelection();

        if (file) {
            this.storyMediaFile = file;
            this.storyMediaPreviewUrl = URL.createObjectURL(file);
            this.storyMediaObjectUrl = this.storyMediaPreviewUrl;
            this.storyComposerError = '';
        }

        input.value = '';
    }

    async publishStory(): Promise<void> {
        if (!this.storyMediaFile || this.postingStory) {
            return;
        }

        this.postingStory = true;
        this.storyComposerError = '';

        try {
            await this.session.createStoryAsync(this.storyMediaFile);
            this.cancelStoryComposer();
            await this.load();
        } catch {
            this.storyComposerError = 'Could not publish story right now.';
        } finally {
            this.postingStory = false;
        }
    }

    ngOnDestroy(): void {
        this.clearStoryMediaSelection();
    }

    async load(): Promise<void> {
        if (this.loadInFlight) {
            this.reloadQueued = true;
            return;
        }

        this.loadInFlight = true;

        try {
            do {
                this.reloadQueued = false;
                this.loading = true;
                this.error = '';

                try {
                    if (!this.viewedHandle && !this.session.profile) {
                        await this.session.refreshMeAsync();
                    }

                    let profile: ProfileDto | null = null;

                    try {
                        profile = this.viewedHandle
                            ? await this.session.loadPublicProfileAsync(this.viewedHandle)
                            : this.session.profile;
                    } catch {
                        profile = null;
                    }

                    if (!profile) {
                        this.error = this.viewedHandle ? 'Could not load this profile.' : 'Could not load your profile.';
                        this.viewedProfile = null;
                        this.posts = [];
                        this.activitySummary = null;
                        continue;
                    }

                    this.viewedProfile = profile;
                    this.showComposer = false;
                    this.showStoryComposer = false;
                    this.showReelComposer = false;
                    this.cancelDeletePost();

                    this.avatarImageUrl = profile.imageUrl?.trim()
                        ? profile.imageUrl
                        : this.buildAvatarImage(profile.displayName, profile.handle);

                    const storyState = await this.loadStoryStateForHandleAsync(profile.handle);
                    this.viewedProfileHasActiveStory = storyState.hasActive;
                    this.viewedProfileHasUnseenStory = storyState.hasUnseen;

                    try {
                        this.posts = await this.loadPostsForProfileAsync(profile.handle);
                    } catch {
                        this.posts = [];
                        this.error = 'Could not load posts for this profile right now.';
                    }

                    try {
                        this.reels = await this.loadReelsForProfileAsync(profile.handle);
                    } catch {
                        this.reels = [];
                        if (!this.error) {
                            this.error = 'Could not load reels for this profile right now.';
                        }
                    }

                    try {
                        this.activitySummary = await this.session.loadProfileActivitySummaryAsync(profile.handle);
                    } catch {
                        this.activitySummary = null;
                    }

                    if (this.isOwnProfile) {
                        this.isFollowing = false;
                        this.isRequested = false;
                        this.followRequiresApproval = false;
                        this.clearFollowStateTimer();
                        this.followState = 'idle';
                    } else {
                        await this.refreshFollowStateAsync(profile.id);
                    }
                } catch {
                    this.error = this.viewedHandle
                        ? 'Could not load this profile right now.'
                        : 'Could not load your profile details right now.';
                    this.viewedProfile = null;
                    this.viewedProfileHasActiveStory = false;
                    this.viewedProfileHasUnseenStory = false;
                    this.posts = [];
                    this.activitySummary = null;
                } finally {
                    this.loading = false;
                }
            } while (this.reloadQueued);
        } finally {
            this.loadInFlight = false;
        }
    }

    displayPostContent(post: PostDto): string {
        if (!post.content) {
            return '';
        }

        if (!post.imageUrl) {
            return post.content;
        }

        return post.content
            .replace(/(?:blob:[^\s]+|https?:\/\/[^\s]+)/gi, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    startEdit(post: PostDto): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.editingPostId = post.id;
        this.editContent = post.content;
        this.error = '';
    }

    cancelEdit(): void {
        this.editingPostId = null;
        this.editContent = '';
    }

    async saveEdit(postId: string): Promise<void> {
        if (this.savingPost) {
            return;
        }

        this.savingPost = true;
        this.error = '';

        try {
            await this.session.updatePostAsync(postId, this.editContent);
            this.cancelEdit();
            await this.load();
        } catch {
            this.error = 'Could not update post.';
        } finally {
            this.savingPost = false;
        }
    }

    requestDeletePost(postId: string): void {
        if (!this.isOwnProfile) {
            return;
        }

        if (this.deletingPostId) {
            return;
        }

        this.pendingDeletePostId = postId;
    }

    cancelDeletePost(): void {
        if (this.deletingPostId) {
            return;
        }

        this.pendingDeletePostId = null;
    }

    async confirmDeletePost(): Promise<void> {
        if (!this.isOwnProfile) {
            return;
        }

        const postId = this.pendingDeletePostId;
        if (!postId || this.deletingPostId) {
            return;
        }

        this.deletingPostId = postId;
        this.error = '';

        try {
            await this.session.deletePostAsync(postId);
            if (this.editingPostId === postId) {
                this.cancelEdit();
            }

            await this.load();
        } catch {
            this.error = 'Could not delete post.';
        } finally {
            this.pendingDeletePostId = null;
            this.deletingPostId = null;
        }
    }

    async toggleLike(post: PostDto): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.togglePostLikeAsync(post.id), 'Could not update like right now.');
    }

    async setReaction(post: PostDto, reactionType: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.setPostReactionAsync(post.id, reactionType), 'Could not set reaction right now.');
    }

    async clearReaction(post: PostDto): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.clearPostReactionAsync(post.id), 'Could not clear reaction right now.');
    }

    async addComment(post: PostDto, payload: string | { content: string; parentCommentId?: string | null }): Promise<void> {
        const content = typeof payload === 'string' ? payload : payload.content;
        const parentCommentId = typeof payload === 'string' ? null : (payload.parentCommentId ?? null);
        await this.runPostMutation(post.id, () => this.session.addCommentAsync(post.id, content, parentCommentId), 'Could not add comment right now.');
    }

    async updateComment(post: PostDto, commentId: string, content: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.updateCommentAsync(post.id, commentId, content), 'Could not update comment right now.');
    }

    async deleteComment(post: PostDto, commentId: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.deleteCommentAsync(post.id, commentId), 'Could not delete comment right now.');
    }

    async setCommentReaction(post: PostDto, commentId: string, reactionType: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.setCommentReactionAsync(post.id, commentId, reactionType), 'Could not react to comment right now.');
    }

    async clearCommentReaction(post: PostDto, commentId: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.clearCommentReactionAsync(post.id, commentId), 'Could not clear comment reaction right now.');
    }

    async sharePostToFeed(post: PostDto): Promise<void> {
        this.openShareModal(post, 'feed');
    }

    async sharePostToChat(post: PostDto): Promise<void> {
        this.openShareModal(post, 'chat');
    }

    async toggleReelLike(reel: ReelDto): Promise<void> {
        if (this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.reactingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.session.toggleReelLikeAsync(reel.id);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    async addReelComment(event: ReelCommentCreateEvent): Promise<void> {
        const { reel, content, parentCommentId } = event;
        const trimmed = content.trim();
        if (!trimmed || this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.session.addReelCommentAsync(reel.id, trimmed, parentCommentId ?? null);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not add reel comment right now.';
        } finally {
            this.commentingReelId = null;
        }
    }

    async updateReelComment(event: ReelCommentUpdateEvent): Promise<void> {
        const { reel, commentId, content } = event;
        const trimmed = content.trim();
        if (!trimmed || this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.session.updateReelCommentAsync(reel.id, commentId, trimmed);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel comment right now.';
        } finally {
            this.commentingReelId = null;
        }
    }

    requestDeleteReelComment(event: ReelCommentDeleteEvent): void {
        this.pendingDeleteReelComment = { reelId: event.reel.id, commentId: event.comment.id };
    }

    cancelDeleteReelComment(): void {
        this.pendingDeleteReelComment = null;
    }

    async confirmDeleteReelComment(): Promise<void> {
        const pending = this.pendingDeleteReelComment;
        if (!pending || this.deletingReelCommentId || this.commentingReelId === pending.reelId) {
            return;
        }

        this.deletingReelCommentId = pending.commentId;
        this.commentingReelId = pending.reelId;
        this.error = '';
        try {
            const updated = await this.session.deleteReelCommentAsync(pending.reelId, pending.commentId);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not delete reel comment right now.';
        } finally {
            this.pendingDeleteReelComment = null;
            this.commentingReelId = null;
            this.deletingReelCommentId = null;
        }
    }

    async toggleReelCommentLike(event: { reel: ReelDto; commentId: string }): Promise<void> {
        const { reel, commentId } = event;
        if (this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.reactingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.session.toggleReelCommentLikeAsync(reel.id, commentId);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel comment like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    async updateReelCaption(reel: ReelDto, caption: string): Promise<void> {
        if (this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.updatingReelId = reel.id;
        this.error = '';

        try {
            const updated = await this.session.updateReelAsync(reel.id, caption);
            this.applyReelUpdate(updated);
        } catch {
            this.error = 'Could not update reel right now.';
        } finally {
            this.updatingReelId = null;
        }
    }

    deleteReel(reel: ReelDto): void {
        if (this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.pendingDeleteReelId = reel.id;
    }

    cancelDeleteReel(): void {
        if (this.deletingReelId) {
            return;
        }

        this.pendingDeleteReelId = null;
    }

    async confirmDeleteReel(): Promise<void> {
        const reelId = this.pendingDeleteReelId;
        if (!reelId || this.updatingReelId || this.deletingReelId) {
            return;
        }

        this.deletingReelId = reelId;
        this.error = '';

        try {
            await this.session.deleteReelAsync(reelId);
            this.reels = this.reels.filter(existing => existing.id !== reelId);
        } catch {
            this.error = 'Could not delete reel right now.';
        } finally {
            this.pendingDeleteReelId = null;
            this.deletingReelId = null;
        }
    }

    async openProfileOrStory(handle: string, event?: MouseEvent): Promise<void> {
        event?.preventDefault();
        event?.stopPropagation();

        const normalized = handle.trim().toLowerCase();
        if (this.viewedProfileHasActiveStory && this.currentProfileHandle === normalized) {
            await this.openStoryForHandle(handle);
            return;
        }

        await this.router.navigate(['/users', handle]);
    }

    closeStoryViewer(): void {
        this.activeStoryGroup = null;
        this.activeStoryIndex = 0;
        this.storyViewerError = '';
        this.sendingStoryReply = false;
        this.sharingStoryMessage = false;
    }

    showPreviousStory(): void {
        if (!this.hasPreviousStory) {
            return;
        }

        this.activeStoryIndex -= 1;
        void this.markActiveStoryViewed();
    }

    showNextStory(): void {
        if (!this.hasNextStory) {
            this.closeStoryViewer();
            return;
        }

        this.activeStoryIndex += 1;
        this.storyViewerError = '';
        void this.markActiveStoryViewed();
    }

    isStoryLiked(storyId: string): boolean {
        return this.likedStoryIds.has(storyId);
    }

    toggleStoryLike(story: StoryDto): void {
        if (this.likedStoryIds.has(story.id)) {
            this.likedStoryIds.delete(story.id);
            return;
        }

        this.likedStoryIds.add(story.id);
    }

    async sendStoryReply(event: { story: StoryDto; message: string }): Promise<void> {
        if (this.sendingStoryReply) {
            return;
        }

        const { story, message } = event;
        if (!message.trim()) {
            return;
        }

        if (story.authorId === this.currentProfileId) {
            this.storyViewerError = 'You cannot send a direct message to yourself.';
            return;
        }

        this.storyViewerError = '';
        this.sendingStoryReply = true;

        try {
            const conversation = await this.session.createDirectConversationAsync(story.authorId);
            await this.session.sendChatMessageAsync(conversation.id, message.trim());
        } catch {
            this.storyViewerError = 'Could not send your story reply right now.';
        } finally {
            this.sendingStoryReply = false;
        }
    }

    async shareStoryAsMessage(_story: StoryDto): Promise<void> {
        this.storyViewerError = 'Story sharing from profile is not available yet.';
    }

    cancelShareModal(): void {
        if (this.sharingPostId) {
            return;
        }

        this.pendingSharePost = null;
        this.pendingShareTarget = null;
        this.shareNote = '';
    }

    async submitShare(note: string): Promise<void> {
        const post = this.pendingSharePost;
        const target = this.pendingShareTarget;
        if (!post || target !== 'feed') {
            return;
        }

        const trimmedNote = note.trim();
        this.shareNote = trimmedNote;

        const succeeded = await this.executeShareToFeed(post, trimmedNote);

        if (succeeded) {
            this.cancelShareModal();
        }
    }

    async submitShareAsMessage(request: SharePostMessageSubmit): Promise<void> {
        const post = this.pendingSharePost;
        const target = this.pendingShareTarget;
        if (!post || target !== 'chat') {
            return;
        }

        const succeeded = await this.executeShareToChat(post, request);

        if (succeeded) {
            this.cancelShareModal();
        }
    }

    private openShareModal(post: PostDto, target: 'feed' | 'chat'): void {
        if (this.sharingPostId || this.savingPost || this.deletingPostId) {
            return;
        }

        this.pendingSharePost = post;
        this.pendingShareTarget = target;
        this.shareNote = '';
    }

    private async executeShareToFeed(post: PostDto, shareText: string): Promise<boolean> {
        if (this.sharingPostId || this.savingPost || this.deletingPostId) {
            return false;
        }

        this.sharingPostId = post.id;
        this.error = '';

        try {
            const marker = buildSharedPostMarker(buildSharedPostPreview(post));
            const message = shareText ? `${shareText}\n${marker}` : marker;
            await this.session.createPostAsync(message);
            await this.load();
            return true;
        } catch {
            this.error = 'Could not share this post right now.';
            return false;
        } finally {
            this.sharingPostId = null;
        }
    }

    private async executeShareToChat(post: PostDto, request: SharePostMessageSubmit): Promise<boolean> {
        if (this.sharingPostId || this.savingPost || this.deletingPostId) {
            return false;
        }

        const recipientIds = request.recipientIds;
        if (!recipientIds.length) {
            return false;
        }

        this.sharingPostId = post.id;
        this.error = '';

        try {
            const marker = buildSharedPostMarker(buildSharedPostPreview(post));
            const shareText = request.note.trim();
            const sendToConversation = async (conversationId: string): Promise<void> => {
                if (shareText) {
                    await this.session.sendChatMessageAsync(conversationId, shareText);
                }
                await this.session.sendChatMessageAsync(conversationId, marker);
            };

            if (request.mode === 'group' && recipientIds.length > 1) {
                const group = await this.session.createGroupConversationAsync('', recipientIds);
                await sendToConversation(group.id);
            } else {
                await Promise.all(recipientIds.map(async (recipientId) => {
                    const conversation = await this.session.createDirectConversationAsync(recipientId);
                    await sendToConversation(conversation.id);
                }));
            }
            return true;
        } catch {
            this.error = 'Could not send this post to chat right now.';
            return false;
        } finally {
            this.sharingPostId = null;
        }
    }

    async toggleFollow(): Promise<void> {
        if (this.isOwnProfile || !this.viewedProfile || this.followState === 'loading') {
            return;
        }

        this.setFollowState('loading');

        try {
            if (this.isFollowing) {
                await this.session.unfollowAsync(this.viewedProfile.id);
                this.isFollowing = false;
                this.isRequested = false;
            } else {
                if (this.isRequested) {
                    await this.session.unfollowAsync(this.viewedProfile.id);
                    this.isRequested = false;
                } else {
                    const result = await this.session.followAsync(this.viewedProfile.id);
                    this.isFollowing = result.status !== 'RequestPending';
                    this.isRequested = result.status === 'RequestPending';
                }
            }

            this.setFollowState('success', 1100);
        } catch {
            this.setFollowState('failure', 1400);
        }
    }

    private applyPostUpdate(updated: PostDto): void {
        this.posts = this.posts.map(post => post.id === updated.id ? updated : post);
    }

    private applyReelUpdate(updated: ReelDto): void {
        this.reels = this.reels.map(reel => reel.id === updated.id ? updated : reel);
    }

    private async runPostMutation(postId: string, work: () => Promise<PostDto>, failureMessage: string): Promise<void> {
        if (this.reactingPostId === postId) {
            return;
        }

        this.reactingPostId = postId;
        try {
            const updated = await work();
            this.applyPostUpdate(updated);
        } catch {
            this.error = failureMessage;
        } finally {
            this.reactingPostId = null;
        }
    }

    private async refreshFollowStateAsync(followedId: string): Promise<void> {
        try {
            const status = await this.session.getFollowStatusAsync(followedId);
            this.isFollowing = status.isFollowing;
            this.isRequested = status.isRequested;
            this.followRequiresApproval = status.requiresApproval;
        } catch {
            this.isFollowing = false;
            this.isRequested = false;
            this.followRequiresApproval = false;
        }
    }

    private async loadPostsForProfileAsync(handle: string): Promise<PostDto[]> {
        try {
            return await this.session.loadPostsByAuthorHandleAsync(handle);
        } catch {
            const fallbackResults = await this.session.searchPostsAsync(handle);
            const normalizedHandle = handle.trim().toLowerCase();
            return fallbackResults.filter(post => post.authorHandle.toLowerCase() === normalizedHandle);
        }
    }

    private async loadReelsForProfileAsync(handle: string): Promise<ReelDto[]> {
        try {
            return await this.session.loadReelsByAuthorHandleAsync(handle);
        } catch {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadReelFeedAsync(80, 'for-you'),
                this.session.loadReelFeedAsync(80, 'following')
            ]);

            const merged = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            const normalizedHandle = handle.trim().toLowerCase();
            return merged.filter(reel => reel.authorHandle.toLowerCase() === normalizedHandle);
        }
    }

    private async loadStoryStateForHandleAsync(handle: string): Promise<{ hasActive: boolean; hasUnseen: boolean }> {
        const normalized = handle.trim().toLowerCase();

        try {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadStoryFeedAsync(80, 'for-you'),
                this.session.loadStoryFeedAsync(80, 'following')
            ]);

            const merged = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            const group = merged.find((item: StoryGroupDto) => item.authorHandle.trim().toLowerCase() === normalized);
            return {
                hasActive: !!group,
                hasUnseen: !!group?.hasUnseenStories
            };
        } catch {
            return { hasActive: false, hasUnseen: false };
        }
    }

    private async openStoryForHandle(handle: string): Promise<void> {
        const group = await this.loadStoryGroupForHandleAsync(handle);
        if (!group || !group.stories.length) {
            await this.router.navigate(['/users', handle]);
            return;
        }

        this.activeStoryGroup = group;
        this.viewedProfileHasActiveStory = true;
        this.viewedProfileHasUnseenStory = group.hasUnseenStories;
        this.activeStoryIndex = this.getNewestUnseenStoryIndex(group.stories);
        this.storyViewerError = '';
        void this.markActiveStoryViewed();
    }

    private async loadStoryGroupForHandleAsync(handle: string): Promise<StoryGroupDto | null> {
        const normalized = handle.trim().toLowerCase();

        try {
            const [forYou, following] = await Promise.allSettled([
                this.session.loadStoryFeedAsync(80, 'for-you'),
                this.session.loadStoryFeedAsync(80, 'following')
            ]);

            const merged = [
                ...(forYou.status === 'fulfilled' ? forYou.value : []),
                ...(following.status === 'fulfilled' ? following.value : [])
            ];

            return merged.find(group => group.authorHandle.trim().toLowerCase() === normalized) ?? null;
        } catch {
            return null;
        }
    }

    private async markActiveStoryViewed(): Promise<void> {
        const story = this.activeStory;
        if (!story || story.viewedByMe || this.markingStoryId) {
            return;
        }

        this.markingStoryId = story.id;
        try {
            await this.session.markStoryViewedAsync(story.id);
            if (!this.activeStoryGroup) {
                return;
            }

            this.activeStoryGroup = {
                ...this.activeStoryGroup,
                stories: this.activeStoryGroup.stories.map(item => item.id === story.id ? { ...item, viewedByMe: true } : item),
                hasUnseenStories: this.activeStoryGroup.stories.some(item => item.id !== story.id && !item.viewedByMe)
            };
            this.viewedProfileHasUnseenStory = this.activeStoryGroup.hasUnseenStories;
        } catch {
            return;
        } finally {
            this.markingStoryId = null;
        }
    }

    private getNewestUnseenStoryIndex(stories: Array<{ viewedByMe: boolean; createdAtUtc: string }>): number {
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

    private clearStoryMediaSelection(): void {
        if (this.storyMediaObjectUrl) {
            URL.revokeObjectURL(this.storyMediaObjectUrl);
        }

        this.storyMediaObjectUrl = '';
        this.storyMediaFile = null;
        this.storyMediaPreviewUrl = '';
    }

    private setFollowState(state: 'idle' | 'loading' | 'success' | 'failure', autoResetMs = 0): void {
        this.followState = state;
        this.clearFollowStateTimer();

        if (autoResetMs > 0) {
            this.followStateResetTimerId = window.setTimeout(() => {
                this.followState = 'idle';
                this.followStateResetTimerId = null;
            }, autoResetMs);
        }
    }

    private clearFollowStateTimer(): void {
        if (this.followStateResetTimerId !== null) {
            window.clearTimeout(this.followStateResetTimerId);
            this.followStateResetTimerId = null;
        }
    }

    private buildAvatarImage(displayName: string, handle: string): string {
        const initial = (displayName.trim().charAt(0) || handle.trim().charAt(0) || 'S').toUpperCase();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1d4ed8" offset="0"/><stop stop-color="#0f172a" offset="1"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="68" font-family="Arial, sans-serif" fill="#ffffff" font-weight="700">${initial}</text></svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    onHeroImageError(): void {
        const profile = this.viewedProfile;
        if (!profile) {
            return;
        }

        this.avatarImageUrl = this.buildAvatarImage(profile.displayName, profile.handle);
    }
}