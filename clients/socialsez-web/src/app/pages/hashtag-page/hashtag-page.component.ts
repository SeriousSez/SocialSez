import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { PostDto, StoryGroupDto } from '../../core/api.types';
import { executePostShareAction, executePostShareToChat } from '../../core/post-share-execution.utils';
import { PostInteractionsService } from '../../core/post-interactions.service';
import { cancelPostShareModal, openPostShareModal } from '../../core/post-share-modal-state.utils';
import { SessionService } from '../../core/session.service';
import { StoryPresenceService } from '../../core/story-presence.service';
import { buildSharedPostReferenceCounts } from '../../core/shared-post.utils';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

@Component({
    selector: 'app-hashtag-page',
    standalone: true,
    imports: [CommonModule, RouterLink, PostCardComponent, SharePostModalComponent, SharePostMessageModalComponent, SkeletonComponent, ConfirmModalComponent],
    templateUrl: './hashtag-page.component.html',
    styleUrl: './hashtag-page.component.scss'
})
export class HashtagPageComponent {
    hashtag = '';
    posts: PostDto[] = [];
    loading = true;
    error = '';
    reactingPostId: string | null = null;
    editingPostId: string | null = null;
    editContent = '';
    savingPost = false;
    deletingPostId: string | null = null;
    pendingDeletePostId: string | null = null;
    sharingPostId: string | null = null;
    pendingSharePost: PostDto | null = null;
    pendingShareTarget: 'feed' | 'chat' | null = null;
    shareNote = '';

    private loadInFlight = false;
    private reloadQueued = false;
    private readonly destroyRef = inject(DestroyRef);
    private activeStoryGroups: StoryGroupDto[] = [];
    private refreshingStoryPresence = false;
    private repostCountSource: PostDto[] | null = null;
    private repostCountsByPostId = new Map<string, number>();

    constructor(
        private readonly session: SessionService,
        private readonly postInteractions: PostInteractionsService,
        private readonly storyPresence: StoryPresenceService,
        private readonly route: ActivatedRoute,
        private readonly router: Router
    ) {
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
            .subscribe(paramMap => {
                this.hashtag = (paramMap.get('tag') ?? '').trim();
                void this.load();
            });
    }

    get currentProfileId(): string | null {
        return this.session.profile?.id ?? null;
    }

    get isAuthenticated(): boolean {
        return this.postInteractions.isAuthenticated();
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
        if (this.repostCountSource === this.posts) {
            return;
        }

        this.repostCountSource = this.posts;
        this.repostCountsByPostId = buildSharedPostReferenceCounts(this.posts);
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
        this.error = '';
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
        this.error = '';

        try {
            await this.session.updatePostAsync(postId, this.editContent);
            const updatedContent = this.editContent;
            this.posts = this.posts.map(post => post.id === postId ? { ...post, content: updatedContent } : post);
            this.cancelEdit();
        } catch {
            this.error = 'Could not update post.';
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
        this.error = '';

        try {
            await this.session.deletePostAsync(postId);
            this.posts = this.posts.filter(post => post.id !== postId);
            if (this.editingPostId === postId) {
                this.cancelEdit();
            }
        } catch {
            this.error = 'Could not delete post.';
        } finally {
            this.pendingDeletePostId = null;
            this.deletingPostId = null;
        }
    }

    async sharePostToFeed(post: PostDto): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

        this.openShareModal(post, 'feed');
    }

    async sharePostToChat(post: PostDto): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

        this.openShareModal(post, 'chat');
    }

    cancelShareModal(): void {
        cancelPostShareModal(this);
    }

    async submitShare(note: string): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

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
        if (!this.isAuthenticated) {
            return;
        }

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
            errorMessage: this.error
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
        this.error = state.errorMessage;
        return succeeded;
    }

    private async executeShareToChat(post: PostDto, request: SharePostMessageSubmit): Promise<boolean> {
        const state = {
            sharingPostId: this.sharingPostId,
            errorMessage: this.error
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
        this.error = state.errorMessage;
        return succeeded;
    }

    async toggleLike(post: PostDto): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

        await this.runPostMutation(post.id, () => this.postInteractions.toggleLike(post.id), 'Could not update like right now.');
    }

    async setReaction(post: PostDto, reactionType: string): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

        await this.runPostMutation(post.id, () => this.postInteractions.setReaction(post.id, reactionType), 'Could not set reaction right now.');
    }

    async clearReaction(post: PostDto): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

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
        if (!this.isAuthenticated) {
            return;
        }

        await this.runPostMutation(post.id, () => this.postInteractions.setCommentReaction(post.id, commentId, reactionType), 'Could not react to comment right now.');
    }

    async clearCommentReaction(post: PostDto, commentId: string): Promise<void> {
        if (!this.isAuthenticated) {
            return;
        }

        await this.runPostMutation(post.id, () => this.postInteractions.clearCommentReaction(post.id, commentId), 'Could not clear comment reaction right now.');
    }

    async load(): Promise<void> {
        if (!this.hashtag) {
            this.posts = [];
            this.loading = false;
            this.error = 'Hashtag is required.';
            return;
        }

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
                void this.refreshActiveStoryPresence();

                try {
                    this.posts = await this.session.loadPostsByHashtagAsync(this.hashtag);
                } catch {
                    this.posts = [];
                    this.error = 'Could not load posts for this hashtag right now.';
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

    private applyPostUpdate(updated: PostDto): void {
        this.posts = this.posts.map(post => post.id === updated.id ? updated : post);
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
}
