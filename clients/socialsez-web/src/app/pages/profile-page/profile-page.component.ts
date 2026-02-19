import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { PostDto, ProfileDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { PostComposerComponent } from '../../shared/post-composer/post-composer.component';
import { PostCardComponent } from '../../shared/post-card/post-card.component';

@Component({
    selector: 'app-profile-page',
    standalone: true,
    imports: [CommonModule, RouterLink, ConfirmModalComponent, PostCardComponent, PostComposerComponent],
    templateUrl: './profile-page.component.html',
    styleUrl: './profile-page.component.scss'
})
export class ProfilePageComponent {
    posts: PostDto[] = [];
    loading = true;
    error = '';
    avatarImageUrl = '';
    editingPostId: string | null = null;
    editContent = '';
    savingPost = false;
    deletingPostId: string | null = null;
    pendingDeletePostId: string | null = null;
    reactingPostId: string | null = null;
    showComposer = false;
    viewedProfile: ProfileDto | null = null;
    viewedHandle: string | null = null;
    followState: 'idle' | 'loading' | 'success' | 'failure' = 'idle';
    isFollowing = false;
    private loadInFlight = false;
    private reloadQueued = false;
    private followStateResetTimerId: number | null = null;
    private readonly destroyRef = inject(DestroyRef);

    constructor(public readonly session: SessionService, private readonly route: ActivatedRoute) {
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
            return this.isFollowing ? 'Following' : 'Unfollowed';
        }

        if (this.followState === 'failure') {
            return 'Try again';
        }

        return this.isFollowing ? 'Unfollow' : 'Follow';
    }

    get totalPosts(): number {
        return this.posts.length;
    }

    get totalCommentsOnPosts(): number {
        return this.posts.reduce((sum, post) => sum + post.comments.length, 0);
    }

    get activeLast7Days(): number {
        const weekAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
        return this.posts.filter(post => Date.parse(post.createdAtUtc) >= weekAgoMs).length;
    }

    openComposer(): void {
        if (!this.isOwnProfile) {
            return;
        }

        this.showComposer = true;
    }

    onComposerCanceled(): void {
        this.showComposer = false;
    }

    async onComposerPosted(): Promise<void> {
        this.showComposer = false;
        await this.load();
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
                        continue;
                    }

                    this.viewedProfile = profile;
                    this.showComposer = false;
                    this.cancelDeletePost();

                    this.avatarImageUrl = profile.imageUrl?.trim()
                        ? profile.imageUrl
                        : this.buildAvatarImage(profile.displayName, profile.handle);

                    try {
                        this.posts = await this.loadPostsForProfileAsync(profile.handle);
                    } catch {
                        this.posts = [];
                        this.error = 'Could not load posts for this profile right now.';
                    }

                    if (this.isOwnProfile) {
                        this.isFollowing = false;
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
                    this.posts = [];
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
            this.pendingDeletePostId = null;
        } catch {
            this.error = 'Could not delete post.';
        } finally {
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

    async addComment(post: PostDto, content: string): Promise<void> {
        await this.runPostMutation(post.id, () => this.session.addCommentAsync(post.id, content), 'Could not add comment right now.');
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

    async toggleFollow(): Promise<void> {
        if (this.isOwnProfile || !this.viewedProfile || this.followState === 'loading') {
            return;
        }

        this.setFollowState('loading');

        try {
            if (this.isFollowing) {
                await this.session.unfollowAsync(this.viewedProfile.id);
                this.isFollowing = false;
            } else {
                await this.session.followAsync(this.viewedProfile.id);
                this.isFollowing = true;
            }

            this.setFollowState('success', 1100);
        } catch {
            this.setFollowState('failure', 1400);
        }
    }

    private applyPostUpdate(updated: PostDto): void {
        this.posts = this.posts.map(post => post.id === updated.id ? updated : post);
    }

    private async runPostMutation(postId: string, work: () => Promise<PostDto>, failureMessage: string): Promise<void> {
        if (this.reactingPostId) {
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
            this.isFollowing = await this.session.isFollowingAsync(followedId);
        } catch {
            this.isFollowing = false;
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
}