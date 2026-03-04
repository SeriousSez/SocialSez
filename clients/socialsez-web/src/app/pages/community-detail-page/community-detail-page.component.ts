import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, NgZone, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommunityDto, CommunityPostDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { actionError, toUserErrorMessage } from '../../core/user-error.utils';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

@Component({
    selector: 'app-community-detail-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, ConfirmModalComponent, SkeletonComponent],
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
    editCommunityModalOpen = false;
    joining = false;
    leaving = false;
    updatingCommunity = false;
    pendingDeletePostId: string | null = null;
    deletingPostId: string | null = null;
    votingPollId: string | null = null;
    togglingSavePostId: string | null = null;
    copiedPostLinkId: string | null = null;
    copiedCommunityLink = false;
    status = '';
    statusTone: 'neutral' | 'success' | 'error' = 'neutral';

    composerContent = '';
    composerImageFile: File | null = null;
    composerImagePreviewUrl: string | null = null;
    enablePoll = false;
    pollQuestion = '';
    pollOptions: string[] = ['', ''];
    updateCommunityName = '';
    updateCommunityInformation = '';
    updateCommunityImageFile: File | null = null;
    updateCommunityImagePreviewUrl: string | null = null;

    private communityId: string | null = null;
    private communitySlug: string | null = null;
    private postLinkCopyTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private communityLinkCopyTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private readonly destroyRef = inject(DestroyRef);
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly ngZone = inject(NgZone);

    private get draftStorageKey(): string | null {
        return this.communitySlug ? `socialsez.community.draft.${this.communitySlug}` : null;
    }

    constructor(private readonly session: SessionService, private readonly route: ActivatedRoute, private readonly router: Router) {
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

    get canLeave(): boolean {
        return !!this.community?.joinedByMe;
    }

    get canEditCommunity(): boolean {
        if (!this.community) {
            return false;
        }

        const role = (this.community.myRole ?? '').trim().toLowerCase();
        if (role === 'owner' || role === 'admin') {
            return true;
        }

        const currentProfileId = this.session.profile?.id;
        if (!!currentProfileId && this.community.createdByProfileId === currentProfileId) {
            return true;
        }

        const currentHandle = (this.session.profile?.handle ?? '').trim().toLowerCase();
        const creatorHandle = (this.community.createdByHandle ?? '').trim().toLowerCase();
        return !!currentHandle && !!creatorHandle && creatorHandle === currentHandle;
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

    async leaveCommunityAsync(): Promise<void> {
        if (!this.communityId || this.leaving || !this.canLeave) {
            return;
        }

        this.leaving = true;
        this.resetStatus();

        try {
            await this.session.leaveCommunityAsync(this.communityId);
            this.community = this.community ? { ...this.community, joinedByMe: false, myRole: undefined, memberCount: Math.max(this.community.memberCount - 1, 0) } : null;
            this.status = 'Left community.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('leave community'));
            this.statusTone = 'error';
        } finally {
            this.leaving = false;
        }
    }

    async shareCommunityAsync(): Promise<void> {
        const slug = this.community?.slug;
        if (!slug) {
            return;
        }

        const communityUrl = `${window.location.origin}/communities/${encodeURIComponent(slug)}`;

        try {
            const copied = await this.copyTextToClipboardAsync(communityUrl);
            if (!copied) {
                throw new Error('Copy failed');
            }

            this.ngZone.run(() => {
                this.copiedCommunityLink = true;
                if (this.communityLinkCopyTimeoutId) {
                    clearTimeout(this.communityLinkCopyTimeoutId);
                }

                this.communityLinkCopyTimeoutId = setTimeout(() => {
                    this.ngZone.run(() => {
                        this.copiedCommunityLink = false;
                        this.communityLinkCopyTimeoutId = null;
                        this.cdr.detectChanges();
                    });
                }, 1800);

                this.status = 'Community link copied.';
                this.statusTone = 'success';
                this.cdr.detectChanges();
            });
        } catch {
            this.ngZone.run(() => {
                this.status = 'Unable to copy community link.';
                this.statusTone = 'error';
                this.cdr.detectChanges();
            });
        }
    }

    openEditCommunityModal(): void {
        if (!this.community || !this.canEditCommunity || this.updatingCommunity) {
            return;
        }

        this.updateCommunityName = this.community.name;
        this.updateCommunityInformation = this.community.description ?? '';
        this.updateCommunityImageFile = null;
        this.updateCommunityImagePreviewUrl = this.community.imageUrl ?? null;
        this.resetStatus();
        this.editCommunityModalOpen = true;
    }

    closeEditCommunityModal(): void {
        if (this.updatingCommunity) {
            return;
        }

        this.editCommunityModalOpen = false;
    }

    onUpdateCommunityImageSelected(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0] ?? null;
        this.updateCommunityImageFile = file;
        this.updateCommunityImagePreviewUrl = file ? URL.createObjectURL(file) : this.community?.imageUrl ?? null;
    }

    async submitCommunityUpdateAsync(): Promise<void> {
        if (!this.communityId || !this.community || !this.canEditCommunity || this.updatingCommunity) {
            return;
        }

        const name = this.updateCommunityName.trim();
        if (!name) {
            this.status = 'Community name is required.';
            this.statusTone = 'neutral';
            return;
        }

        this.updatingCommunity = true;
        this.resetStatus();

        try {
            let imageUrl = this.community.imageUrl ?? null;
            if (this.updateCommunityImageFile) {
                imageUrl = await this.session.uploadImageAsync(this.updateCommunityImageFile);
            }

            const previousSlug = this.community.slug;
            const updated = await this.session.updateCommunityAsync(
                this.communityId,
                name,
                this.updateCommunityInformation.trim() || null,
                imageUrl,
                this.community.isPrivate
            );

            this.community = updated;
            this.communityId = updated.id;
            this.communitySlug = updated.slug;
            this.updateCommunityImageFile = null;
            this.editCommunityModalOpen = false;
            this.status = 'Community updated.';
            this.statusTone = 'success';

            if (!stringEqualsIgnoreCase(previousSlug, updated.slug)) {
                await this.router.navigate(['/communities', updated.slug], { replaceUrl: true });
            }
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('update community'));
            this.statusTone = 'error';
        } finally {
            this.updatingCommunity = false;
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

    async sharePostAsync(post: CommunityPostDto): Promise<void> {
        const postUrl = `${window.location.origin}/shared/community-post/${post.id}`;

        try {
            const copied = await this.copyTextToClipboardAsync(postUrl);
            if (!copied) {
                throw new Error('Copy failed');
            }

            this.ngZone.run(() => {
                this.copiedPostLinkId = post.id;
                if (this.postLinkCopyTimeoutId) {
                    clearTimeout(this.postLinkCopyTimeoutId);
                }

                this.postLinkCopyTimeoutId = setTimeout(() => {
                    this.ngZone.run(() => {
                        this.copiedPostLinkId = null;
                        this.postLinkCopyTimeoutId = null;
                        this.cdr.detectChanges();
                    });
                }, 1800);

                this.status = 'Post link copied.';
                this.statusTone = 'success';
                this.cdr.detectChanges();
            });
        } catch {
            this.ngZone.run(() => {
                this.status = 'Unable to copy post link.';
                this.statusTone = 'error';
                this.cdr.detectChanges();
            });
        }
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

    canDeletePost(post: CommunityPostDto): boolean {
        const currentProfileId = this.session.profile?.id;
        if (!currentProfileId) {
            return false;
        }

        if (post.authorId === currentProfileId) {
            return true;
        }

        const role = this.community?.myRole;
        return role === 'Owner' || role === 'Admin';
    }

    requestDeletePost(post: CommunityPostDto): void {
        if (this.deletingPostId || !this.canDeletePost(post)) {
            return;
        }

        this.pendingDeletePostId = post.id;
    }

    cancelDeletePost(): void {
        if (this.deletingPostId) {
            return;
        }

        this.pendingDeletePostId = null;
    }

    async confirmDeletePost(): Promise<void> {
        const postId = this.pendingDeletePostId;
        if (!this.communityId || !postId || this.deletingPostId) {
            return;
        }

        const post = this.posts.find(item => item.id === postId);
        if (!post || !this.canDeletePost(post)) {
            this.pendingDeletePostId = null;
            return;
        }

        this.deletingPostId = postId;
        this.resetStatus();

        try {
            await this.session.deleteCommunityPostAsync(this.communityId, postId);
            this.posts = this.posts.filter(item => item.id !== postId);
            this.status = 'Post deleted.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('delete post'));
            this.statusTone = 'error';
        } finally {
            this.pendingDeletePostId = null;
            this.deletingPostId = null;
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

function stringEqualsIgnoreCase(left: string, right: string): boolean {
    return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}
