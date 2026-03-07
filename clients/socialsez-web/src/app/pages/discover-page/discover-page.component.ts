import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, NgZone, OnDestroy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { BlogDto, CommunityDto, CommunityPostDto, HashtagSearchResultDto, PostDto, ProfileDto, ReelDto, StoryGroupDto } from '../../core/api.types';
import { executePostShareAction, executePostShareToChat } from '../../core/post-share-execution.utils';
import { PostInteractionsService } from '../../core/post-interactions.service';
import { cancelPostShareModal, openPostShareModal } from '../../core/post-share-modal-state.utils';
import { ReelInteractionsService } from '../../core/reel-interactions.service';
import { StoryPresenceService } from '../../core/story-presence.service';
import { buildSharedPostReferenceCounts } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';
import { actionError, toUserErrorMessage } from '../../core/user-error.utils';
import { FeedReelsListComponent, ReelCommentCreateEvent, ReelCommentDeleteEvent, ReelCommentUpdateEvent } from '../feed-page/feed-reels-list.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

type SearchScope = 'all' | 'posts' | 'hashtags' | 'users' | 'reels' | 'communities' | 'community-posts' | 'blogs';

@Component({
    selector: 'app-discover-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, PostCardComponent, FeedReelsListComponent, SharePostModalComponent, SharePostMessageModalComponent, SkeletonComponent, ConfirmModalComponent],
    templateUrl: './discover-page.component.html',
    styleUrl: './discover-page.component.scss'
})
export class DiscoverPageComponent implements OnDestroy {
    query = '';
    selectedScope: SearchScope = 'all';
    profileResults: ProfileDto[] = [];
    postResults: PostDto[] = [];
    hashtagResults: HashtagSearchResultDto[] = [];
    reelResults: ReelDto[] = [];
    communityResults: CommunityDto[] = [];
    communityPostResults: CommunityPostDto[] = [];
    blogResults: BlogDto[] = [];
    recommendedReels: ReelDto[] = [];
    recommendedProfiles: ProfileDto[] = [];

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
        { value: 'communities', label: 'Communities' },
        { value: 'community-posts', label: 'Community posts' },
        { value: 'blogs', label: 'Blogs' },
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
    private repostCountSource: PostDto[] | null = null;
    private repostCountsByPostId = new Map<string, number>();
    private queryDebounceTimerId: number | null = null;
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly ngZone = inject(NgZone);

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
                    this.cdr.detectChanges();
                    return;
                }

                const type = this.normalizeScope(params.get('type'));
                this.query = query;
                this.selectedScope = type;
                this.recommendedReels = [];
                void this.runSearch(query);
                this.cdr.detectChanges();
            });

        this.session.appChanges$
            .pipe(
                filter(change => change === 'posts' || change === 'profile' || change === 'session'),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                void this.refreshActiveStoryPresence();
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

    onQueryInput(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        if (target) {
            this.query = target.value;
        }

        this.onQueryChanged();
    }

    onQueryChanged(): void {
        if (this.queryDebounceTimerId !== null) {
            window.clearTimeout(this.queryDebounceTimerId);
            this.queryDebounceTimerId = null;
        }

        this.queryDebounceTimerId = window.setTimeout(() => {
            this.queryDebounceTimerId = null;
            this.ngZone.run(() => {
                void this.search();
            });
        }, 240);
    }

    ngOnDestroy(): void {
        if (this.queryDebounceTimerId !== null) {
            window.clearTimeout(this.queryDebounceTimerId);
            this.queryDebounceTimerId = null;
        }
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
        return this.profileResults.length > 0
            || this.reelResults.length > 0
            || this.postResults.length > 0
            || this.hashtagResults.length > 0
            || this.communityResults.length > 0
            || this.communityPostResults.length > 0
            || this.blogResults.length > 0;
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

    get showCommunitiesSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'communities';
    }

    get showCommunityPostsSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'community-posts';
    }

    get showBlogsSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'blogs';
    }

    get showingSearchResults(): boolean {
        return !!this.query.trim();
    }

    get showRecommendedReelsSection(): boolean {
        return !this.showingSearchResults;
    }

    get showRecommendedProfilesSection(): boolean {
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

    getPostRepostCount(postId: string): number {
        this.ensurePostRepostCounts();
        return this.repostCountsByPostId.get(postId) ?? 0;
    }

    private ensurePostRepostCounts(): void {
        if (this.repostCountSource === this.postResults) {
            return;
        }

        this.repostCountSource = this.postResults;
        this.repostCountsByPostId = buildSharedPostReferenceCounts(this.postResults);
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('update post'));
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('delete post'));
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('follow this user'));
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('update reel like'));
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('add reel comment'));
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('update reel comment'));
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('delete reel comment'));
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
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('update reel comment like'));
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
                            this.profileResults = this.rankProfiles(await this.session.searchProfilesAsync(query), query);
                            break;
                        case 'reels':
                            this.reelResults = this.rankReels(await this.searchReelsAsync(query), query);
                            break;
                        case 'posts':
                            this.postResults = this.rankPosts(await this.session.searchPostsAsync(query), query);
                            break;
                        case 'communities':
                            this.communityResults = this.rankCommunities(await this.session.discoverCommunitiesAsync(query, 60), query);
                            break;
                        case 'community-posts':
                            this.communityPostResults = this.rankCommunityPosts(await this.session.searchCommunityPostsAsync(query, 60), query);
                            break;
                        case 'blogs':
                            this.blogResults = this.rankBlogs(await this.session.discoverBlogsAsync(query, 60), query);
                            break;
                        case 'hashtags': {
                            const [hashtags, reels] = await Promise.allSettled([
                                this.loadHashtagsWithFallback(query),
                                this.searchReelsAsync(query)
                            ]);

                            const hashtagMatches = hashtags.status === 'fulfilled' ? hashtags.value : [];
                            const reelHashtagMatches = reels.status === 'fulfilled'
                                ? this.extractHashtagsFromReels(reels.value, query)
                                : [];
                            this.hashtagResults = this.rankHashtags(this.mergeHashtagResults(hashtagMatches, reelHashtagMatches), query);
                            break;
                        }
                        case 'all': {
                            const [users, reels, posts, hashtags, communities, communityPosts, blogs] = await Promise.allSettled([
                                this.session.searchProfilesAsync(query),
                                this.searchReelsAsync(query),
                                this.session.searchPostsAsync(query),
                                this.loadHashtagsWithFallback(query),
                                this.session.discoverCommunitiesAsync(query, 60),
                                this.session.searchCommunityPostsAsync(query, 60),
                                this.session.discoverBlogsAsync(query, 60)
                            ]);

                            this.profileResults = users.status === 'fulfilled' ? this.rankProfiles(users.value, query) : [];
                            this.reelResults = reels.status === 'fulfilled' ? this.rankReels(reels.value, query) : [];
                            this.postResults = posts.status === 'fulfilled' ? this.rankPosts(posts.value, query) : [];
                            this.communityResults = communities.status === 'fulfilled' ? this.rankCommunities(communities.value, query) : [];
                            this.communityPostResults = communityPosts.status === 'fulfilled' ? this.rankCommunityPosts(communityPosts.value, query) : [];
                            this.blogResults = blogs.status === 'fulfilled' ? this.rankBlogs(blogs.value, query) : [];

                            const hashtagMatches = hashtags.status === 'fulfilled' ? hashtags.value : [];
                            const reelHashtagMatches = reels.status === 'fulfilled'
                                ? this.extractHashtagsFromReels(reels.value, query)
                                : [];
                            this.hashtagResults = this.rankHashtags(this.mergeHashtagResults(hashtagMatches, reelHashtagMatches), query);

                            if (
                                users.status === 'rejected'
                                && reels.status === 'rejected'
                                && posts.status === 'rejected'
                                && hashtags.status === 'rejected'
                                && communities.status === 'rejected'
                                && communityPosts.status === 'rejected'
                                && blogs.status === 'rejected'
                            ) {
                                throw new Error('All searches failed.');
                            }
                            break;
                        }
                    }

                    if (!this.hasAnyResults) {
                        this.status = 'No results found.';
                    }
                } catch (error) {
                    this.status = toUserErrorMessage(error, actionError('complete search'));
                } finally {
                    this.loading = false;
                    this.cdr.detectChanges();
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
        this.communityResults = [];
        this.communityPostResults = [];
        this.blogResults = [];
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
                this.recommendedProfiles = [];

                try {
                    const [recommended, followingProfiles, followSuggestions] = await Promise.all([
                        this.session.loadReelFeedAsync(60, 'for-you'),
                        this.session.loadFollowingAsync(250),
                        this.session.isAuthenticated() ? this.session.loadFollowSuggestionsAsync(8) : Promise.resolve({ following: [], relevant: [] })
                    ]);

                    const followingIds = new Set(followingProfiles.map(profile => profile.id));
                    const myProfileId = this.currentProfileId;
                    this.recommendedReels = recommended.filter(reel => {
                        if (myProfileId && reel.authorId === myProfileId) {
                            return false;
                        }

                        return !followingIds.has(reel.authorId);
                    });

                    const mergedProfiles = [...followSuggestions.relevant, ...followSuggestions.following];
                    const uniqueProfiles = new Map<string, ProfileDto>();
                    for (const profile of mergedProfiles) {
                        if (myProfileId && profile.id === myProfileId) {
                            continue;
                        }

                        if (followingIds.has(profile.id)) {
                            continue;
                        }

                        if (!uniqueProfiles.has(profile.id)) {
                            uniqueProfiles.set(profile.id, profile);
                        }
                    }

                    this.recommendedProfiles = Array.from(uniqueProfiles.values()).slice(0, 10);
                } catch (error) {
                    this.status = toUserErrorMessage(error, actionError('load recommended reels'));
                } finally {
                    this.loading = false;
                    this.cdr.detectChanges();
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

    private extractHashtagsFromReels(reels: ReadonlyArray<ReelDto>, query: string): HashtagSearchResultDto[] {
        const normalized = query.trim().replace(/^#/, '').toLowerCase();
        const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
        const counts = new Map<string, number>();

        for (const reel of reels) {
            const candidates = [reel.caption, ...reel.comments.map(comment => comment.content)];
            for (const candidate of candidates) {
                if (!candidate) {
                    continue;
                }

                const uniqueTags = new Set<string>();
                for (const match of candidate.matchAll(hashtagRegex)) {
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
        }

        return Array.from(counts.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    }

    private mergeHashtagResults(primary: ReadonlyArray<HashtagSearchResultDto>, secondary: ReadonlyArray<HashtagSearchResultDto>): HashtagSearchResultDto[] {
        const merged = new Map<string, HashtagSearchResultDto>();

        for (const item of [...primary, ...secondary]) {
            const key = item.tag.trim().toLowerCase();
            if (!key) {
                continue;
            }

            const existing = merged.get(key);
            if (!existing) {
                merged.set(key, { tag: item.tag, count: item.count });
                continue;
            }

            merged.set(key, {
                tag: existing.tag,
                count: existing.count + item.count
            });
        }

        return Array.from(merged.values())
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
            .slice(0, 25);
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
        const reelMatches = Array.from(deduped.values()).filter(reel =>
            matches(reel.authorHandle)
            || matches(reel.caption)
            || reel.comments.some(comment => matches(comment.content) || matches(comment.authorHandle)));

        let profileMatches: ProfileDto[] = [];
        try {
            profileMatches = await this.session.searchProfilesAsync(query);
        } catch {
            profileMatches = [];
        }

        const matchingHandles = profileMatches
            .map(profile => profile.handle?.trim().toLowerCase())
            .filter((handle): handle is string => !!handle)
            .slice(0, 8);

        if (!matchingHandles.length) {
            return reelMatches;
        }

        const authorReelResults = await Promise.allSettled(
            matchingHandles.map(handle => this.isAuthenticated
                ? this.session.loadReelsByAuthorHandleAsync(handle, 12)
                : this.session.loadPublicReelsByAuthorHandleAsync(handle, 12))
        );

        for (const result of authorReelResults) {
            if (result.status !== 'fulfilled') {
                continue;
            }

            for (const reel of result.value) {
                if (!deduped.has(reel.id)) {
                    deduped.set(reel.id, reel);
                }
            }
        }

        const finalMatches = Array.from(deduped.values()).filter(reel =>
            matches(reel.authorHandle)
            || matches(reel.caption)
            || reel.comments.some(comment => matches(comment.content) || matches(comment.authorHandle))
            || matchingHandles.includes((reel.authorHandle ?? '').trim().toLowerCase()));

        return finalMatches;
    }

    private rankProfiles(profiles: ReadonlyArray<ProfileDto>, query: string): ProfileDto[] {
        const term = query.trim().toLowerCase();
        if (!term) {
            return [...profiles];
        }

        const score = (profile: ProfileDto): number => {
            const handle = profile.handle.toLowerCase();
            const displayName = profile.displayName.toLowerCase();
            let rank = 0;

            if (handle === term) {
                rank += 120;
            } else if (handle.startsWith(term)) {
                rank += 90;
            } else if (handle.includes(term)) {
                rank += 55;
            }

            if (displayName === term) {
                rank += 70;
            } else if (displayName.startsWith(term)) {
                rank += 45;
            } else if (displayName.includes(term)) {
                rank += 25;
            }

            return rank;
        };

        return [...profiles].sort((left, right) =>
            score(right) - score(left)
            || left.handle.localeCompare(right.handle));
    }

    private rankPosts(posts: ReadonlyArray<PostDto>, query: string): PostDto[] {
        const term = query.trim().toLowerCase();
        if (!term) {
            return [...posts];
        }

        const score = (post: PostDto): number => {
            const content = (post.content ?? '').toLowerCase();
            const author = (post.authorHandle ?? '').toLowerCase();
            let rank = 0;

            if (author === term) {
                rank += 60;
            } else if (author.startsWith(term)) {
                rank += 40;
            } else if (author.includes(term)) {
                rank += 25;
            }

            if (content.startsWith(term)) {
                rank += 75;
            } else if (content.includes(term)) {
                rank += 50;
            }

            return rank;
        };

        return [...posts].sort((left, right) =>
            score(right) - score(left)
            || Date.parse(right.createdAtUtc) - Date.parse(left.createdAtUtc));
    }

    private rankReels(reels: ReadonlyArray<ReelDto>, query: string): ReelDto[] {
        const term = query.trim().toLowerCase();
        if (!term) {
            return [...reels];
        }

        const score = (reel: ReelDto): number => {
            const author = (reel.authorHandle ?? '').toLowerCase();
            const caption = (reel.caption ?? '').toLowerCase();
            const commentsText = reel.comments.map(comment => `${comment.authorHandle} ${comment.content}`).join(' ').toLowerCase();
            let rank = 0;

            if (author === term) {
                rank += 80;
            } else if (author.startsWith(term)) {
                rank += 55;
            } else if (author.includes(term)) {
                rank += 30;
            }

            if (caption.startsWith(term)) {
                rank += 65;
            } else if (caption.includes(term)) {
                rank += 40;
            }

            if (commentsText.includes(term)) {
                rank += 20;
            }

            return rank;
        };

        return [...reels].sort((left, right) =>
            score(right) - score(left)
            || Date.parse(right.createdAtUtc) - Date.parse(left.createdAtUtc));
    }

    private rankHashtags(tags: ReadonlyArray<HashtagSearchResultDto>, query: string): HashtagSearchResultDto[] {
        const term = query.trim().replace(/^#/, '').toLowerCase();
        if (!term) {
            return [...tags];
        }

        const score = (tag: HashtagSearchResultDto): number => {
            const normalizedTag = tag.tag.toLowerCase();
            if (normalizedTag === term) {
                return 1000 + tag.count;
            }

            if (normalizedTag.startsWith(term)) {
                return 500 + tag.count;
            }

            if (normalizedTag.includes(term)) {
                return 200 + tag.count;
            }

            return tag.count;
        };

        return [...tags].sort((left, right) =>
            score(right) - score(left)
            || left.tag.localeCompare(right.tag));
    }

    private rankCommunities(communities: ReadonlyArray<CommunityDto>, query: string): CommunityDto[] {
        const term = query.trim().toLowerCase();
        if (!term) {
            return [...communities];
        }

        const score = (community: CommunityDto): number => {
            const name = (community.name ?? '').toLowerCase();
            const slug = (community.slug ?? '').toLowerCase();
            const description = (community.description ?? '').toLowerCase();
            let rank = 0;

            if (name === term) {
                rank += 120;
            } else if (name.startsWith(term)) {
                rank += 80;
            } else if (name.includes(term)) {
                rank += 45;
            }

            if (slug === term) {
                rank += 90;
            } else if (slug.startsWith(term)) {
                rank += 65;
            } else if (slug.includes(term)) {
                rank += 35;
            }

            if (description.includes(term)) {
                rank += 20;
            }

            rank += Math.min(community.memberCount, 1000) / 25;
            return rank;
        };

        return [...communities].sort((left, right) =>
            score(right) - score(left)
            || right.memberCount - left.memberCount
            || left.name.localeCompare(right.name));
    }

    private rankCommunityPosts(posts: ReadonlyArray<CommunityPostDto>, query: string): CommunityPostDto[] {
        const term = query.trim().toLowerCase();
        if (!term) {
            return [...posts];
        }

        const score = (post: CommunityPostDto): number => {
            const title = (post.title ?? '').toLowerCase();
            const content = (post.content ?? '').toLowerCase();
            const author = (post.authorHandle ?? '').toLowerCase();
            let rank = 0;

            if (title === term) {
                rank += 110;
            } else if (title.startsWith(term)) {
                rank += 75;
            } else if (title.includes(term)) {
                rank += 45;
            }

            if (content.includes(term)) {
                rank += 35;
            }

            if (author === term) {
                rank += 30;
            } else if (author.startsWith(term)) {
                rank += 20;
            } else if (author.includes(term)) {
                rank += 10;
            }

            rank += Math.min(post.upvoteCount, 500) / 15;
            return rank;
        };

        return [...posts].sort((left, right) =>
            score(right) - score(left)
            || Date.parse(right.createdAtUtc) - Date.parse(left.createdAtUtc));
    }

    private rankBlogs(blogs: ReadonlyArray<BlogDto>, query: string): BlogDto[] {
        const term = query.trim().toLowerCase();
        if (!term) {
            return [...blogs];
        }

        const score = (blog: BlogDto): number => {
            const title = (blog.title ?? '').toLowerCase();
            const slug = (blog.slug ?? '').toLowerCase();
            const description = (blog.description ?? '').toLowerCase();
            const owner = (blog.ownerHandle ?? '').toLowerCase();
            let rank = 0;

            if (title === term) {
                rank += 120;
            } else if (title.startsWith(term)) {
                rank += 85;
            } else if (title.includes(term)) {
                rank += 50;
            }

            if (slug.startsWith(term)) {
                rank += 40;
            } else if (slug.includes(term)) {
                rank += 20;
            }

            if (description.includes(term)) {
                rank += 25;
            }

            if (owner === term) {
                rank += 45;
            } else if (owner.startsWith(term)) {
                rank += 30;
            } else if (owner.includes(term)) {
                rank += 15;
            }

            return rank;
        };

        return [...blogs].sort((left, right) =>
            score(right) - score(left)
            || Date.parse(right.updatedAtUtc) - Date.parse(left.updatedAtUtc));
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
            case 'communities':
            case 'community-posts':
            case 'blogs':
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