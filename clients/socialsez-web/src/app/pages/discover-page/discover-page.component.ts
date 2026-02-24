import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HashtagSearchResultDto, PostDto, ProfileDto, ReelDto, StoryGroupDto } from '../../core/api.types';
import { executePostShareAction, executePostShareToChat } from '../../core/post-share-execution.utils';
import { PostInteractionsService } from '../../core/post-interactions.service';
import { cancelPostShareModal, openPostShareModal } from '../../core/post-share-modal-state.utils';
import { ReelInteractionsService } from '../../core/reel-interactions.service';
import { StoryPresenceService } from '../../core/story-presence.service';
import { SessionService } from '../../core/session.service';
import { FeedReelsListComponent, ReelCommentCreateEvent, ReelCommentDeleteEvent, ReelCommentUpdateEvent } from '../feed-page/feed-reels-list.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

type SearchScope = 'all' | 'posts' | 'hashtags' | 'users' | 'reels';

@Component({
    selector: 'app-discover-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, PostCardComponent, FeedReelsListComponent, SharePostModalComponent, SharePostMessageModalComponent, SkeletonComponent, ConfirmModalComponent],
    templateUrl: './discover-page.component.html',
    styleUrl: './discover-page.component.scss'
})
export class DiscoverPageComponent {
    query = '';
    selectedScope: SearchScope = 'all';
    profileResults: ProfileDto[] = [];
    postResults: PostDto[] = [];
    hashtagResults: HashtagSearchResultDto[] = [];
    reelResults: ReelDto[] = [];
    recommendedReels: ReelDto[] = [];

    loading = false;
    status = '';
    reactingPostId: string | null = null;
    reactingReelId: string | null = null;
    commentingReelId: string | null = null;
    deletingReelCommentId: string | null = null;
    pendingDeleteReelComment: { reelId: string; commentId: string } | null = null;
    editingPostId: string | null = null;
    editContent = '';
    savingPost = false;
    deletingPostId: string | null = null;
    pendingDeletePostId: string | null = null;
    sharingPostId: string | null = null;
    pendingSharePost: PostDto | null = null;
    pendingShareTarget: 'feed' | 'chat' | null = null;
    shareNote = '';

    readonly scopes: ReadonlyArray<{ value: SearchScope; label: string }> = [
        { value: 'all', label: 'All' },
        { value: 'reels', label: 'Reels' },
        { value: 'posts', label: 'Posts' },
        { value: 'hashtags', label: 'Hashtags' },
        { value: 'users', label: 'Users' }
    ];

    private loadInFlight = false;
    private reloadQueued = false;
    private loadingRecommendedReels = false;
    private reloadRecommendedReelsQueued = false;
    private readonly destroyRef = inject(DestroyRef);
    private activeStoryGroups: StoryGroupDto[] = [];
    private refreshingStoryPresence = false;

    constructor(
        private readonly session: SessionService,
        private readonly postInteractions: PostInteractionsService,
        private readonly reelInteractions: ReelInteractionsService,
        private readonly storyPresence: StoryPresenceService,
        private readonly route: ActivatedRoute,
        private readonly router: Router
    ) {
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const query = (params.get('q') ?? '').trim();
                if (!query) {
                    this.query = '';
                    this.selectedScope = 'all';
                    this.clearResults();
                    this.status = '';
                    void this.loadRecommendedNonFollowingReels();
                    return;
                }

                const type = this.normalizeScope(params.get('type'));
                this.query = query;
                this.selectedScope = type;
                this.recommendedReels = [];
                void this.runSearch(query);
            });
    }

    async search(): Promise<void> {
        const trimmedQuery = this.query.trim();
        if (!trimmedQuery) {
            await this.router.navigate(['/discover']);
            return;
        }

        await this.router.navigate(['/discover'], { queryParams: { q: trimmedQuery, type: this.selectedScope } });
    }

    async changeScope(scope: SearchScope): Promise<void> {
        if (scope === this.selectedScope) {
            return;
        }

        this.selectedScope = scope;
        if (!this.query.trim()) {
            return;
        }

        await this.router.navigate(['/discover'], { queryParams: { q: this.query.trim(), type: this.selectedScope } });
    }

    get currentProfileId(): string | null {
        return this.session.profile?.id ?? null;
    }

    get isAuthenticated(): boolean {
        return this.postInteractions.isAuthenticated();
    }

    get activeStoryAuthorHandles(): string[] {
        return this.storyPresence.getActiveStoryAuthorHandles(this.activeStoryGroups);
    }

    get unseenStoryAuthorHandles(): string[] {
        return this.storyPresence.getUnseenStoryAuthorHandles(this.activeStoryGroups);
    }

    hasActiveStoryForHandle(handle: string): boolean {
        return this.storyPresence.hasActiveStoryForHandle(this.activeStoryGroups, handle);
    }

    hasUnseenStoryForHandle(handle: string): boolean {
        return this.storyPresence.hasUnseenStoryForHandle(this.activeStoryGroups, handle);
    }

    async openProfileOrStory(handle: string, event: MouseEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        if (this.hasActiveStoryForHandle(handle)) {
            await this.router.navigate(['/feed'], { queryParams: { story: handle } });
            return;
        }

        await this.router.navigate(['/users', handle]);
    }

    get hasAnyResults(): boolean {
        return this.profileResults.length > 0 || this.reelResults.length > 0 || this.postResults.length > 0 || this.hashtagResults.length > 0;
    }

    get showUsersSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'users';
    }

    get showPostsSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'posts';
    }

    get showReelsSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'reels';
    }

    get showHashtagsSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'hashtags';
    }

    get showingSearchResults(): boolean {
        return !!this.query.trim();
    }

    get showRecommendedReelsSection(): boolean {
        return !this.showingSearchResults;
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

    canManagePost(post: PostDto): boolean {
        return !!this.currentProfileId && post.authorId === this.currentProfileId;
    }

    startEdit(post: PostDto): void {
        if (!this.canManagePost(post) || this.savingPost || this.deletingPostId) {
            return;
        }

        this.editingPostId = post.id;
        this.editContent = post.content;
        this.status = '';
    }

    cancelEdit(): void {
        if (this.savingPost) {
            return;
        }

        this.editingPostId = null;
        this.editContent = '';
    }

    async saveEdit(postId: string): Promise<void> {
        if (this.savingPost || this.deletingPostId) {
            return;
        }

        this.savingPost = true;
        this.status = '';

        try {
            await this.session.updatePostAsync(postId, this.editContent);
            const updatedContent = this.editContent;
            this.postResults = this.postResults.map(post => post.id === postId ? { ...post, content: updatedContent } : post);
            this.cancelEdit();
        } catch {
            this.status = 'Could not update post.';
        } finally {
            this.savingPost = false;
        }
    }

    requestDeletePost(postId: string): void {
        if (this.deletingPostId || this.savingPost) {
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
        const postId = this.pendingDeletePostId;
        if (!postId || this.deletingPostId || this.savingPost) {
            return;
        }

        this.deletingPostId = postId;
        this.status = '';

        try {
            await this.session.deletePostAsync(postId);
            this.postResults = this.postResults.filter(post => post.id !== postId);
            if (this.editingPostId === postId) {
                this.cancelEdit();
            }
        } catch {
            this.status = 'Could not delete post.';
        } finally {
            this.pendingDeletePostId = null;
            this.deletingPostId = null;
        }
    }

    async sharePostToFeed(post: PostDto): Promise<void> {
        this.openShareModal(post, 'feed');
    }

    async sharePostToChat(post: PostDto): Promise<void> {
        this.openShareModal(post, 'chat');
    }

    cancelShareModal(): void {
        cancelPostShareModal(this);
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
        openPostShareModal(this, post, target, this.savingPost, !!this.deletingPostId);
    }

    private async executeShareToFeed(post: PostDto, shareText: string): Promise<boolean> {
        const state = {
            sharingPostId: this.sharingPostId,
            errorMessage: this.status
        };

        const succeeded = await executePostShareAction(
            state,
            post.id,
            () => this.postInteractions.shareToFeed(post, shareText),
            'Could not share this post right now.',
            this.savingPost,
            !!this.deletingPostId
        );

        this.sharingPostId = state.sharingPostId;
        this.status = state.errorMessage;
        if (succeeded) {
            this.status = 'Post shared.';
        }

        return succeeded;
    }

    private async executeShareToChat(post: PostDto, request: SharePostMessageSubmit): Promise<boolean> {
        const state = {
            sharingPostId: this.sharingPostId,
            errorMessage: this.status
        };

        const succeeded = await executePostShareToChat(
            state,
            post.id,
            request.recipientIds,
            () => this.postInteractions.shareToChat(post, request),
            'Could not send this post to chat right now.',
            this.savingPost,
            !!this.deletingPostId
        );

        this.sharingPostId = state.sharingPostId;
        this.status = state.errorMessage;
        if (succeeded) {
            this.status = 'Post sent as message.';
        }

        return succeeded;
    }

    async follow(profile: ProfileDto): Promise<void> {
        if (!this.isAuthenticated) {
            await this.router.navigate(['/auth']);
            return;
        }

        try {
            const result = await this.session.followAsync(profile.id);
            this.status = result.status === 'RequestPending'
                ? `Follow request sent to @${profile.handle}.`
                : `Followed @${profile.handle}.`;
        } catch {
            this.status = 'Could not follow user.';
        }
    }

    async toggleLike(post: PostDto): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.toggleLike(post.id), 'Could not update like right now.');
    }

    async setReaction(post: PostDto, reactionType: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.setReaction(post.id, reactionType), 'Could not set reaction right now.');
    }

    async clearReaction(post: PostDto): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.clearReaction(post.id), 'Could not clear reaction right now.');
    }

    async addComment(post: PostDto, payload: string | { content: string; parentCommentId?: string | null }): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

        const content = typeof payload === 'string' ? payload : payload.content;
        const parentCommentId = typeof payload === 'string' ? null : (payload.parentCommentId ?? null);
        await this.runPostMutation(post.id, () => this.postInteractions.addComment(post.id, content, parentCommentId), 'Could not add comment right now.');
    }

    async updateComment(post: PostDto, commentId: string, content: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.updateComment(post.id, commentId, content), 'Could not update comment right now.');
    }

    async deleteComment(post: PostDto, commentId: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.deleteComment(post.id, commentId), 'Could not delete comment right now.');
    }

    async setCommentReaction(post: PostDto, commentId: string, reactionType: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.setCommentReaction(post.id, commentId, reactionType), 'Could not react to comment right now.');
    }

    async clearCommentReaction(post: PostDto, commentId: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.postInteractions.clearCommentReaction(post.id, commentId), 'Could not clear comment reaction right now.');
    }

    async toggleReelLike(reel: ReelDto): Promise<void> {
        if (this.reactingReelId === reel.id || this.commentingReelId === reel.id) {
            return;
        }

        this.reactingReelId = reel.id;
        this.status = '';
        try {
            const updated = await this.reelInteractions.toggleLike(reel.id);
            this.applyReelUpdate(updated);
        } catch {
            this.status = 'Could not update reel like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    async addReelComment(event: ReelCommentCreateEvent): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

        const { reel, content, parentCommentId } = event;
        if (this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.status = '';
        try {
            const updated = await this.reelInteractions.addComment(reel.id, content, parentCommentId ?? null);
            this.pendingDeleteReelComment = null;
            this.applyReelUpdate(updated);
        } catch {
            this.status = 'Could not add reel comment right now.';
        } finally {
            this.commentingReelId = null;
        }
    }

    async updateReelComment(event: ReelCommentUpdateEvent): Promise<void> {
        const { reel, commentId, content } = event;
        if (this.commentingReelId === reel.id) {
            return;
        }

        this.commentingReelId = reel.id;
        this.status = '';
        try {
            const updated = await this.reelInteractions.updateComment(reel.id, commentId, content);
            this.applyReelUpdate(updated);
        } catch {
            this.status = 'Could not update reel comment right now.';
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
        this.status = '';
        try {
            const updated = await this.reelInteractions.deleteComment(pending.reelId, pending.commentId);
            this.applyReelUpdate(updated);
        } catch {
            this.status = 'Could not delete reel comment right now.';
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
        this.status = '';
        try {
            const updated = await this.reelInteractions.toggleCommentLike(reel.id, commentId);
            this.applyReelUpdate(updated);
        } catch {
            this.status = 'Could not update reel comment like right now.';
        } finally {
            this.reactingReelId = null;
        }
    }

    async openProfileByHandle(handle: string): Promise<void> {
        const normalized = (handle ?? '').trim();
        if (!normalized) {
            return;
        }

        await this.router.navigate(['/users', normalized]);
    }

    private async runSearch(query: string): Promise<void> {
        if (this.loadInFlight) {
            this.reloadQueued = true;
            return;
        }

        this.loadInFlight = true;

        try {
            do {
                this.reloadQueued = false;
                this.loading = true;
                this.status = '';
                this.clearResults();
                this.recommendedReels = [];
                void this.refreshActiveStoryPresence();

                try {
                    switch (this.selectedScope) {
                        case 'users':
                            this.profileResults = await this.session.searchProfilesAsync(query);
                            break;
                        case 'reels':
                            this.reelResults = await this.searchReelsAsync(query);
                            break;
                        case 'posts':
                            this.postResults = await this.session.searchPostsAsync(query);
                            break;
                        case 'hashtags':
                            this.hashtagResults = await this.loadHashtagsWithFallback(query);
                            break;
                        case 'all': {
                            const [users, reels, posts, hashtags] = await Promise.allSettled([
                                this.session.searchProfilesAsync(query),
                                this.searchReelsAsync(query),
                                this.session.searchPostsAsync(query),
                                this.loadHashtagsWithFallback(query)
                            ]);

                            this.profileResults = users.status === 'fulfilled' ? users.value : [];
                            this.reelResults = reels.status === 'fulfilled' ? reels.value : [];
                            this.postResults = posts.status === 'fulfilled' ? posts.value : [];
                            this.hashtagResults = hashtags.status === 'fulfilled' ? hashtags.value : [];

                            if (users.status === 'rejected' && reels.status === 'rejected' && posts.status === 'rejected' && hashtags.status === 'rejected') {
                                throw new Error('All searches failed.');
                            }
                            break;
                        }
                    }

                    if (!this.hasAnyResults) {
                        this.status = 'No results found.';
                    }
                } catch {
                    this.status = 'Search failed. Please try again.';
                } finally {
                    this.loading = false;
                }
            } while (this.reloadQueued);
        } finally {
            this.loadInFlight = false;
        }
    }

    private async refreshActiveStoryPresence(): Promise<void> {
        if (this.refreshingStoryPresence) {
            return;
        }

        this.refreshingStoryPresence = true;
        try {
            this.activeStoryGroups = await this.storyPresence.loadActiveStoryGroups();
        } catch {
            this.activeStoryGroups = [];
        } finally {
            this.refreshingStoryPresence = false;
        }
    }

    private clearResults(): void {
        this.profileResults = [];
        this.reelResults = [];
        this.postResults = [];
        this.hashtagResults = [];
    }

    private async loadRecommendedNonFollowingReels(): Promise<void> {
        if (this.loadingRecommendedReels) {
            this.reloadRecommendedReelsQueued = true;
            return;
        }

        this.loadingRecommendedReels = true;
        try {
            do {
                this.reloadRecommendedReelsQueued = false;
                this.loading = true;
                this.status = '';
                this.recommendedReels = [];

                try {
                    const [recommended, followingProfiles] = await Promise.all([
                        this.session.loadReelFeedAsync(60, 'for-you'),
                        this.session.loadFollowingAsync(250)
                    ]);

                    const followingIds = new Set(followingProfiles.map(profile => profile.id));
                    const myProfileId = this.currentProfileId;
                    this.recommendedReels = recommended.filter(reel => {
                        if (myProfileId && reel.authorId === myProfileId) {
                            return false;
                        }

                        return !followingIds.has(reel.authorId);
                    });
                } catch {
                    this.status = 'Could not load recommended reels right now.';
                } finally {
                    this.loading = false;
                }
            } while (this.reloadRecommendedReelsQueued);
        } finally {
            this.loadingRecommendedReels = false;
        }
    }

    private async loadHashtagsWithFallback(query: string): Promise<HashtagSearchResultDto[]> {
        try {
            return await this.session.searchHashtagsAsync(query);
        } catch {
            const posts = await this.session.searchPostsAsync(query);
            return this.extractHashtagsFromPosts(posts, query);
        }
    }

    private extractHashtagsFromPosts(posts: ReadonlyArray<PostDto>, query: string): HashtagSearchResultDto[] {
        const normalized = query.trim().replace(/^#/, '').toLowerCase();
        const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
        const counts = new Map<string, number>();

        for (const post of posts) {
            if (!post.content) {
                continue;
            }

            const uniqueTags = new Set<string>();
            for (const match of post.content.matchAll(hashtagRegex)) {
                const rawTag = match[0]?.slice(1);
                if (!rawTag) {
                    continue;
                }

                if (normalized && !rawTag.toLowerCase().includes(normalized)) {
                    continue;
                }

                uniqueTags.add(rawTag);
            }

            for (const tag of uniqueTags) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }

        return Array.from(counts.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    }

    private applyPostUpdate(updated: PostDto): void {
        this.postResults = this.postResults.map(post => post.id === updated.id ? updated : post);
    }

    private applyReelUpdate(updated: ReelDto): void {
        this.reelResults = this.reelResults.map(reel => reel.id === updated.id ? updated : reel);
        this.recommendedReels = this.recommendedReels.map(reel => reel.id === updated.id ? updated : reel);
    }

    private async searchReelsAsync(query: string): Promise<ReelDto[]> {
        const term = query.trim().toLowerCase();
        if (!term) {
            return [];
        }

        const [forYou, following] = await Promise.allSettled([
            this.session.loadReelFeedAsync(80, 'for-you'),
            this.session.loadReelFeedAsync(80, 'following')
        ]);

        const merged = [
            ...(forYou.status === 'fulfilled' ? forYou.value : []),
            ...(following.status === 'fulfilled' ? following.value : [])
        ];

        const deduped = new Map<string, ReelDto>();
        for (const reel of merged) {
            if (!deduped.has(reel.id)) {
                deduped.set(reel.id, reel);
            }
        }

        const matches = (value: string | null | undefined): boolean => (value ?? '').toLowerCase().includes(term);
        return Array.from(deduped.values()).filter(reel =>
            matches(reel.authorHandle)
            || matches(reel.caption)
            || reel.comments.some(comment => matches(comment.content) || matches(comment.authorHandle)));
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
            this.status = failureMessage;
        } finally {
            this.reactingPostId = null;
        }
    }

    private normalizeScope(raw: string | null): SearchScope {
        switch (raw) {
            case 'users':
            case 'reels':
            case 'posts':
            case 'hashtags':
            case 'all':
                return raw;
            default:
                return 'all';
        }
    }
}