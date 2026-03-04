import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommunityDto, CommunityPostDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { actionError, toUserErrorMessage } from '../../core/user-error.utils';

@Component({
    selector: 'app-community-detail-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './community-detail-page.component.html',
    styleUrl: './community-detail-page.component.scss'
})
export class CommunityDetailPageComponent {
    community: CommunityDto | null = null;
    posts: CommunityPostDto[] = [];
    postSearchQuery = '';

    loading = false;
    posting = false;
    createPostModalOpen = false;
    joining = false;
    votingPollId: string | null = null;
    togglingSavePostId: string | null = null;
    status = '';
    statusTone: 'neutral' | 'success' | 'error' = 'neutral';

    composerContent = '';
    composerImageFile: File | null = null;
    composerImagePreviewUrl: string | null = null;
    enablePoll = false;
    pollQuestion = '';
    pollOptions: string[] = ['', ''];

    private communityId: string | null = null;
    private communitySlug: string | null = null;
    private readonly destroyRef = inject(DestroyRef);

    private get draftStorageKey(): string | null {
        return this.communitySlug ? `socialsez.community.draft.${this.communitySlug}` : null;
    }

    constructor(private readonly session: SessionService, private readonly route: ActivatedRoute) {
        this.route.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                this.communitySlug = params.get('slug');
                void this.loadAsync();
            });
    }

    get canPost(): boolean {
        return !!this.community?.joinedByMe;
    }

    async loadAsync(): Promise<void> {
        if (!this.communitySlug) {
            this.community = null;
            this.posts = [];
            return;
        }

        this.loading = true;
        this.resetStatus();

        try {
            const community = await this.session.getCommunityBySlugAsync(this.communitySlug);

            if (!community) {
                this.community = null;
                this.communityId = null;
                this.posts = [];
                this.status = 'Community was not found.';
                this.statusTone = 'neutral';
                return;
            }

            this.communityId = community.id;
            const posts = await this.session.loadCommunityPostsAsync(community.id, this.postSearchQuery);

            this.community = community;
            this.posts = posts;
            this.restoreDraft();
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('load community'));
            this.statusTone = 'error';
        } finally {
            this.loading = false;
        }
    }

    onComposerImageSelected(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0] ?? null;
        this.composerImageFile = file;
        this.composerImagePreviewUrl = file ? URL.createObjectURL(file) : null;
        this.persistDraft();
    }

    onComposerChanged(): void {
        this.persistDraft();
    }

    addPollOption(): void {
        if (this.pollOptions.length >= 6) {
            return;
        }

        this.pollOptions = [...this.pollOptions, ''];
        this.persistDraft();
    }

    removePollOption(index: number): void {
        if (this.pollOptions.length <= 2) {
            return;
        }

        this.pollOptions = this.pollOptions.filter((_, itemIndex) => itemIndex !== index);
        this.persistDraft();
    }

    async joinCommunityAsync(): Promise<void> {
        if (!this.communityId || this.joining) {
            return;
        }

        this.joining = true;
        this.resetStatus();

        try {
            this.community = await this.session.joinCommunityAsync(this.communityId);
            this.status = 'Joined community.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('join community'));
            this.statusTone = 'error';
        } finally {
            this.joining = false;
        }
    }

    async submitPostAsync(): Promise<void> {
        if (!this.communityId || this.posting || !this.canPost) {
            return;
        }

        const content = this.composerContent.trim() || null;
        const pollQuestion = this.enablePoll ? this.pollQuestion.trim() || null : null;
        const pollOptions = this.enablePoll
            ? this.pollOptions.map(option => option.trim()).filter(option => !!option)
            : null;

        if (!content && !this.composerImageFile && !pollQuestion) {
            this.status = 'Add text, image, or poll before posting.';
            this.statusTone = 'neutral';
            return;
        }

        this.posting = true;
        this.resetStatus();

        try {
            let imageUrl: string | null = null;
            if (this.composerImageFile) {
                imageUrl = await this.session.uploadImageAsync(this.composerImageFile);
            }

            const created = await this.session.createCommunityPostAsync(
                this.communityId,
                content,
                imageUrl,
                pollQuestion,
                pollOptions
            );

            this.posts = [created, ...this.posts];
            this.composerContent = '';
            this.composerImageFile = null;
            this.composerImagePreviewUrl = null;
            this.enablePoll = false;
            this.pollQuestion = '';
            this.pollOptions = ['', ''];
            this.createPostModalOpen = false;
            this.clearDraft();
            this.status = 'Post published.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('create post'));
            this.statusTone = 'error';
        } finally {
            this.posting = false;
        }
    }

    openCreatePostModal(): void {
        if (!this.canPost) {
            return;
        }

        this.resetStatus();
        this.restoreDraft();
        this.createPostModalOpen = true;
    }

    closeCreatePostModal(): void {
        if (this.posting) {
            return;
        }

        this.persistDraft();
        this.createPostModalOpen = false;
    }

    async searchPostsAsync(): Promise<void> {
        if (!this.communityId || this.loading) {
            return;
        }

        this.loading = true;
        this.resetStatus();

        try {
            this.posts = await this.session.loadCommunityPostsAsync(this.communityId, this.postSearchQuery);
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('search posts'));
            this.statusTone = 'error';
        } finally {
            this.loading = false;
        }
    }

    async clearSearchAsync(): Promise<void> {
        this.postSearchQuery = '';
        await this.searchPostsAsync();
    }

    async toggleSavePostAsync(post: CommunityPostDto): Promise<void> {
        if (!this.communityId || this.togglingSavePostId) {
            return;
        }

        this.togglingSavePostId = post.id;
        this.resetStatus();

        try {
            if (post.isSavedByMe) {
                await this.session.unsaveCommunityPostAsync(this.communityId, post.id);
                this.posts = this.posts.map(item => item.id === post.id ? { ...item, isSavedByMe: false } : item);
                this.status = 'Post removed from saved.';
                this.statusTone = 'success';
                return;
            }

            const saved = await this.session.saveCommunityPostAsync(this.communityId, post.id);
            this.posts = this.posts.map(item => item.id === post.id ? saved : item);
            this.status = 'Post saved.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError(post.isSavedByMe ? 'unsave post' : 'save post'));
            this.statusTone = 'error';
        } finally {
            this.togglingSavePostId = null;
        }
    }

    async votePollAsync(postId: string, pollId: string, optionId: string): Promise<void> {
        if (!this.communityId || this.votingPollId) {
            return;
        }

        this.votingPollId = pollId;
        this.resetStatus();

        try {
            const poll = await this.session.voteCommunityPollAsync(this.communityId, pollId, optionId);
            this.posts = this.posts.map(post => post.id === postId ? { ...post, poll } : post);
            this.status = 'Vote submitted.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('vote on poll'));
            this.statusTone = 'error';
        } finally {
            this.votingPollId = null;
        }
    }

    trackByPostId(_index: number, post: CommunityPostDto): string {
        return post.id;
    }

    private persistDraft(): void {
        const key = this.draftStorageKey;
        if (!key) {
            return;
        }

        const hasDraft = !!this.composerContent.trim()
            || this.enablePoll
            || !!this.pollQuestion.trim()
            || this.pollOptions.some(option => !!option.trim());

        if (!hasDraft) {
            localStorage.removeItem(key);
            return;
        }

        localStorage.setItem(key, JSON.stringify({
            composerContent: this.composerContent,
            enablePoll: this.enablePoll,
            pollQuestion: this.pollQuestion,
            pollOptions: this.pollOptions
        }));
    }

    private restoreDraft(): void {
        const key = this.draftStorageKey;
        if (!key) {
            return;
        }

        const raw = localStorage.getItem(key);
        if (!raw) {
            return;
        }

        try {
            const parsed = JSON.parse(raw) as {
                composerContent?: string;
                enablePoll?: boolean;
                pollQuestion?: string;
                pollOptions?: string[];
            };

            this.composerContent = parsed.composerContent ?? '';
            this.enablePoll = !!parsed.enablePoll;
            this.pollQuestion = parsed.pollQuestion ?? '';
            this.pollOptions = (parsed.pollOptions?.length ? parsed.pollOptions : ['', '']).slice(0, 6);
            while (this.pollOptions.length < 2) {
                this.pollOptions.push('');
            }
        } catch {
            localStorage.removeItem(key);
        }
    }

    private clearDraft(): void {
        const key = this.draftStorageKey;
        if (key) {
            localStorage.removeItem(key);
        }
    }

    private resetStatus(): void {
        this.status = '';
        this.statusTone = 'neutral';
    }
}
