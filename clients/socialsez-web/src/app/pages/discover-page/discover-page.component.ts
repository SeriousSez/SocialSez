import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HashtagSearchResultDto, PostDto, ProfileDto } from '../../core/api.types';
import { buildSharedPostMarker, buildSharedPostPreview } from '../../core/shared-post.utils';
import { SessionService } from '../../core/session.service';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SharePostMessageModalComponent, SharePostMessageSubmit } from '../../shared/share-post-message-modal/share-post-message-modal.component';
import { SharePostModalComponent } from '../../shared/share-post-modal/share-post-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

type SearchScope = 'all' | 'posts' | 'hashtags' | 'users';

@Component({
    selector: 'app-discover-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, PostCardComponent, SharePostModalComponent, SharePostMessageModalComponent, SkeletonComponent],
    templateUrl: './discover-page.component.html',
    styleUrl: './discover-page.component.scss'
})
export class DiscoverPageComponent {
    query = '';
    selectedScope: SearchScope = 'all';
    profileResults: ProfileDto[] = [];
    postResults: PostDto[] = [];
    hashtagResults: HashtagSearchResultDto[] = [];

    loading = false;
    status = '';
    reactingPostId: string | null = null;
    editingPostId: string | null = null;
    editContent = '';
    savingPost = false;
    deletingPostId: string | null = null;
    sharingPostId: string | null = null;
    pendingSharePost: PostDto | null = null;
    pendingShareTarget: 'feed' | 'chat' | null = null;
    shareNote = '';

    readonly scopes: ReadonlyArray<{ value: SearchScope; label: string }> = [
        { value: 'all', label: 'All' },
        { value: 'posts', label: 'Posts' },
        { value: 'hashtags', label: 'Hashtags' },
        { value: 'users', label: 'Users' }
    ];

    private loadInFlight = false;
    private reloadQueued = false;
    private readonly destroyRef = inject(DestroyRef);

    constructor(private readonly session: SessionService, private readonly route: ActivatedRoute, private readonly router: Router) {
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const query = (params.get('q') ?? '').trim();
                if (!query) {
                    this.query = '';
                    this.clearResults();
                    this.loading = false;
                    this.status = '';
                    return;
                }

                const type = this.normalizeScope(params.get('type'));
                this.query = query;
                this.selectedScope = type;
                void this.runSearch(query);
            });
    }

    async search(): Promise<void> {
        const trimmedQuery = this.query.trim();
        if (!trimmedQuery) {
            this.clearResults();
            this.status = 'Enter a search query.';
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

    get hasAnyResults(): boolean {
        return this.profileResults.length > 0 || this.postResults.length > 0 || this.hashtagResults.length > 0;
    }

    get showUsersSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'users';
    }

    get showPostsSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'posts';
    }

    get showHashtagsSection(): boolean {
        return this.selectedScope === 'all' || this.selectedScope === 'hashtags';
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

    async deletePost(postId: string): Promise<void> {
        if (this.deletingPostId || this.savingPost) {
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
        this.status = '';

        try {
            const marker = buildSharedPostMarker(buildSharedPostPreview(post));
            const message = shareText ? `${shareText}\n${marker}` : marker;
            await this.session.createPostAsync(message);
            this.status = 'Post shared.';
            return true;
        } catch {
            this.status = 'Could not share this post right now.';
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
        this.status = '';

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
            this.status = 'Post sent as message.';
            return true;
        } catch {
            this.status = 'Could not send this post to chat right now.';
            return false;
        } finally {
            this.sharingPostId = null;
        }
    }

    async follow(profile: ProfileDto): Promise<void> {
        try {
            await this.session.followAsync(profile.id);
            this.status = `Followed @${profile.handle}.`;
        } catch {
            this.status = 'Could not follow user.';
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

                try {
                    switch (this.selectedScope) {
                        case 'users':
                            this.profileResults = await this.session.searchProfilesAsync(query);
                            break;
                        case 'posts':
                            this.postResults = await this.session.searchPostsAsync(query);
                            break;
                        case 'hashtags':
                            this.hashtagResults = await this.loadHashtagsWithFallback(query);
                            break;
                        case 'all': {
                            const [users, posts, hashtags] = await Promise.allSettled([
                                this.session.searchProfilesAsync(query),
                                this.session.searchPostsAsync(query),
                                this.loadHashtagsWithFallback(query)
                            ]);

                            this.profileResults = users.status === 'fulfilled' ? users.value : [];
                            this.postResults = posts.status === 'fulfilled' ? posts.value : [];
                            this.hashtagResults = hashtags.status === 'fulfilled' ? hashtags.value : [];

                            if (users.status === 'rejected' && posts.status === 'rejected' && hashtags.status === 'rejected') {
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

    private clearResults(): void {
        this.profileResults = [];
        this.postResults = [];
        this.hashtagResults = [];
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

    private async runPostMutation(postId: string, work: () => Promise<PostDto>, failureMessage: string): Promise<void> {
        if (this.reactingPostId) {
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
            case 'posts':
            case 'hashtags':
            case 'all':
                return raw;
            default:
                return 'all';
        }
    }
}