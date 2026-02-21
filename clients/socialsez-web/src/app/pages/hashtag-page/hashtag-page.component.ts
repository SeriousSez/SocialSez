import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { PostDto } from '../../core/api.types';
import { buildSharedPostMarker, buildSharedPostPreview } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

@Component({
    selector: 'app-hashtag-page',
    standalone: true,
    imports: [CommonModule, RouterLink, PostCardComponent, SharePostModalComponent, SharePostMessageModalComponent, SkeletonComponent],
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
    sharingPostId: string | null = null;
    pendingSharePost: PostDto | null = null;
    pendingShareTarget: 'feed' | 'chat' | null = null;
    shareNote = '';

    private loadInFlight = false;
    private reloadQueued = false;
    private readonly destroyRef = inject(DestroyRef);

    constructor(private readonly session: SessionService, private readonly route: ActivatedRoute, private readonly router: Router) {
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

    async deletePost(postId: string): Promise<void> {
        if (this.deletingPostId || this.savingPost) {
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
}
