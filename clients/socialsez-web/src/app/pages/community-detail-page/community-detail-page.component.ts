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

type CommunityComposerTab = 'text' | 'media' | 'link' | 'poll';

interface EditImageEntry {
    url: string;
    file: File | null;
    isObjectUrl: boolean;
}

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
    editPostModalOpen = false;
    joining = false;
    leaving = false;
    updatingCommunity = false;
    updatingPost = false;
    pendingDeletePostId: string | null = null;
    deletingPostId: string | null = null;
    editingPostId: string | null = null;
    votingPollId: string | null = null;
    votingPostId: string | null = null;
    togglingSavePostId: string | null = null;
    copiedPostLinkId: string | null = null;
    copiedCommunityLink = false;
    fullscreenImageUrl: string | null = null;
    status = '';
    statusTone: 'neutral' | 'success' | 'error' = 'neutral';

    composerContent = '';
    composerMediaContent = '';
    composerTitle = '';
    composerLinkUrl = '';
    composerTab: CommunityComposerTab = 'text';
    composerImageFiles: File[] = [];
    composerImagePreviewUrls: string[] = [];
    composerActiveImageIndex = 0;
    pollQuestion = '';
    pollOptions: string[] = ['', ''];
    updateCommunityName = '';
    updateCommunityInformation = '';
    updateCommunityImageFile: File | null = null;
    updateCommunityImagePreviewUrl: string | null = null;
    editPostTitle = '';
    editPostContent = '';
    editPostMediaContent = '';
    editPostLinkUrl = '';
    editPostTab: CommunityComposerTab = 'text';
    editPostImageEntries: EditImageEntry[] = [];
    editPostActiveImageIndex = 0;
    editPollQuestion = '';
    editPollOptions: string[] = ['', ''];

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

    onComposerImagesSelected(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const selectedFiles = target?.files ? Array.from(target.files) : [];
        if (!selectedFiles.length) {
            return;
        }

        const remainingSlots = Math.max(0, 10 - this.composerImageFiles.length);
        if (!remainingSlots) {
            return;
        }

        const accepted = selectedFiles
            .filter(file => file.type.startsWith('image/'))
            .slice(0, remainingSlots);

        if (!accepted.length) {
            return;
        }

        const nextFiles = [...this.composerImageFiles, ...accepted];
        const nextPreviews = [...this.composerImagePreviewUrls, ...accepted.map(file => URL.createObjectURL(file))];

        this.composerImageFiles = nextFiles;
        this.composerImagePreviewUrls = nextPreviews;
        this.composerActiveImageIndex = this.composerImageFiles.length - accepted.length;

        if (target) {
            target.value = '';
        }

        this.persistDraft();
    }

    setComposerTab(tab: CommunityComposerTab): void {
        this.composerTab = tab;
        this.persistDraft();
    }

    isComposerTab(tab: CommunityComposerTab): boolean {
        return this.composerTab === tab;
    }

    get activeComposerImagePreviewUrl(): string | null {
        if (!this.composerImagePreviewUrls.length) {
            return null;
        }

        const safeIndex = Math.min(Math.max(this.composerActiveImageIndex, 0), this.composerImagePreviewUrls.length - 1);
        return this.composerImagePreviewUrls[safeIndex] ?? null;
    }

    get canMoveComposerImageBack(): boolean {
        return this.composerActiveImageIndex > 0;
    }

    get canMoveComposerImageForward(): boolean {
        return this.composerActiveImageIndex < this.composerImagePreviewUrls.length - 1;
    }

    showPreviousComposerImage(): void {
        if (!this.canMoveComposerImageBack) {
            return;
        }

        this.composerActiveImageIndex -= 1;
        this.persistDraft();
    }

    showNextComposerImage(): void {
        if (!this.canMoveComposerImageForward) {
            return;
        }

        this.composerActiveImageIndex += 1;
        this.persistDraft();
    }

    setActiveComposerImage(index: number): void {
        if (index < 0 || index >= this.composerImagePreviewUrls.length) {
            return;
        }

        this.composerActiveImageIndex = index;
        this.persistDraft();
    }

    removeComposerImage(index: number): void {
        if (index < 0 || index >= this.composerImageFiles.length) {
            return;
        }

        const previewToRevoke = this.composerImagePreviewUrls[index];
        if (previewToRevoke) {
            URL.revokeObjectURL(previewToRevoke);
        }

        this.composerImageFiles = this.composerImageFiles.filter((_, itemIndex) => itemIndex !== index);
        this.composerImagePreviewUrls = this.composerImagePreviewUrls.filter((_, itemIndex) => itemIndex !== index);
        if (this.composerActiveImageIndex >= this.composerImageFiles.length) {
            this.composerActiveImageIndex = Math.max(0, this.composerImageFiles.length - 1);
        }

        this.persistDraft();
    }

    onComposerChanged(): void {
        this.persistDraft();
    }

    setEditPostTab(tab: CommunityComposerTab): void {
        this.editPostTab = tab;
    }

    isEditPostTab(tab: CommunityComposerTab): boolean {
        return this.editPostTab === tab;
    }

    onEditPostImagesSelected(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const selectedFiles = target?.files ? Array.from(target.files) : [];
        if (!selectedFiles.length) {
            return;
        }

        const remainingSlots = Math.max(0, 10 - this.editPostImageEntries.length);
        if (!remainingSlots) {
            return;
        }

        const accepted = selectedFiles
            .filter(file => file.type.startsWith('image/'))
            .slice(0, remainingSlots)
            .map(file => ({
                url: URL.createObjectURL(file),
                file,
                isObjectUrl: true
            } as EditImageEntry));

        if (!accepted.length) {
            return;
        }

        this.editPostImageEntries = [...this.editPostImageEntries, ...accepted];
        this.editPostActiveImageIndex = this.editPostImageEntries.length - accepted.length;

        if (target) {
            target.value = '';
        }
    }

    get activeEditPostImagePreviewUrl(): string | null {
        if (!this.editPostImageEntries.length) {
            return null;
        }

        const safeIndex = Math.min(Math.max(this.editPostActiveImageIndex, 0), this.editPostImageEntries.length - 1);
        return this.editPostImageEntries[safeIndex]?.url ?? null;
    }

    get canMoveEditPostImageBack(): boolean {
        return this.editPostActiveImageIndex > 0;
    }

    get canMoveEditPostImageForward(): boolean {
        return this.editPostActiveImageIndex < this.editPostImageEntries.length - 1;
    }

    showPreviousEditPostImage(): void {
        if (!this.canMoveEditPostImageBack) {
            return;
        }

        this.editPostActiveImageIndex -= 1;
    }

    showNextEditPostImage(): void {
        if (!this.canMoveEditPostImageForward) {
            return;
        }

        this.editPostActiveImageIndex += 1;
    }

    setActiveEditPostImage(index: number): void {
        if (index < 0 || index >= this.editPostImageEntries.length) {
            return;
        }

        this.editPostActiveImageIndex = index;
    }

    removeEditPostImage(index: number): void {
        if (index < 0 || index >= this.editPostImageEntries.length) {
            return;
        }

        const entry = this.editPostImageEntries[index];
        if (entry?.isObjectUrl) {
            URL.revokeObjectURL(entry.url);
        }

        this.editPostImageEntries = this.editPostImageEntries.filter((_, itemIndex) => itemIndex !== index);
        if (this.editPostActiveImageIndex >= this.editPostImageEntries.length) {
            this.editPostActiveImageIndex = Math.max(0, this.editPostImageEntries.length - 1);
        }
    }

    addEditPollOption(): void {
        if (this.editPollOptions.length >= 6) {
            return;
        }

        this.editPollOptions = [...this.editPollOptions, ''];
    }

    removeEditPollOption(index: number): void {
        if (this.editPollOptions.length <= 2) {
            return;
        }

        this.editPollOptions = this.editPollOptions.filter((_, itemIndex) => itemIndex !== index);
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

        const content = this.resolveComposerPostContent();
        const title = this.composerTitle.trim() || null;
        const linkUrl = this.composerTab === 'link' ? this.composerLinkUrl.trim() || null : null;
        const pollQuestion = this.composerTab === 'poll' ? this.pollQuestion.trim() || null : null;
        const pollOptions = this.composerTab === 'poll'
            ? this.pollOptions.map(option => option.trim()).filter(option => !!option)
            : null;
        const selectedImages = this.composerTab === 'media' ? [...this.composerImageFiles] : [];

        if (!title) {
            this.status = 'Title is required.';
            this.statusTone = 'neutral';
            return;
        }

        if (!content && !linkUrl && selectedImages.length === 0 && !pollQuestion) {
            this.status = 'Add text, image, link, or poll before posting.';
            this.statusTone = 'neutral';
            return;
        }

        this.posting = true;
        this.resetStatus();

        try {
            const imageUrls: string[] = [];
            for (const imageFile of selectedImages) {
                const uploaded = await this.session.uploadImageAsync(imageFile);
                if (uploaded) {
                    imageUrls.push(uploaded);
                }
            }

            const created = await this.session.createCommunityPostAsync(
                this.communityId,
                title,
                linkUrl,
                content,
                imageUrls.length ? imageUrls : null,
                pollQuestion,
                pollOptions
            );

            this.posts = [created, ...this.posts];
            this.composerTitle = '';
            this.composerContent = '';
            this.composerMediaContent = '';
            this.composerLinkUrl = '';
            this.composerTab = 'text';
            this.clearComposerImages();
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

    async openPostAsync(postId: string): Promise<void> {
        await this.router.navigate(['/shared/community-post', postId]);
    }

    onPostCardKeydown(event: KeyboardEvent, postId: string): void {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        void this.openPostAsync(postId);
    }

    async toggleUpvote(postId: string, event: Event): Promise<void> {
        event.stopPropagation();
        await this.votePostAsync(postId, 'Upvote');
    }

    async toggleDownvote(postId: string, event: Event): Promise<void> {
        event.stopPropagation();
        await this.votePostAsync(postId, 'Downvote');
    }

    isUpvoted(postId: string): boolean {
        return this.posts.find(post => post.id === postId)?.myVoteType === 'Upvote';
    }

    isDownvoted(postId: string): boolean {
        return this.posts.find(post => post.id === postId)?.myVoteType === 'Downvote';
    }

    getVoteScore(postId: string): number {
        const post = this.posts.find(item => item.id === postId);
        if (!post) {
            return 0;
        }

        return post.upvoteCount - post.downvoteCount;
    }

    getPostPrimaryLink(post: CommunityPostDto): string | null {
        const linkUrl = post.linkUrl?.trim();
        if (linkUrl) {
            return linkUrl;
        }

        const content = post.content?.trim();
        if (!content) {
            return null;
        }

        const match = content.match(/https?:\/\/[^\s)]+/i);
        return match?.[0] ?? null;
    }

    openPostFromCommentAction(postId: string, event: Event): void {
        event.stopPropagation();
        void this.openPostAsync(postId);
    }

    openImageFullscreen(imageUrl: string, event: Event): void {
        event.stopPropagation();
        this.fullscreenImageUrl = imageUrl;
    }

    closeImageFullscreen(): void {
        this.fullscreenImageUrl = null;
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

    private async votePostAsync(postId: string, voteType: 'Upvote' | 'Downvote'): Promise<void> {
        if (!this.communityId || this.votingPostId) {
            return;
        }

        const post = this.posts.find(item => item.id === postId);
        if (!post) {
            return;
        }

        this.votingPostId = postId;
        this.resetStatus();

        try {
            const nextVoteType = post.myVoteType === voteType ? undefined : voteType;
            const updated = await this.session.voteCommunityPostAsync(this.communityId, postId, nextVoteType);
            this.posts = this.posts.map(item => item.id === postId ? updated : item);
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('vote on post'));
            this.statusTone = 'error';
        } finally {
            this.votingPostId = null;
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

    canEditPost(post: CommunityPostDto): boolean {
        const currentProfileId = this.session.profile?.id;
        if (!currentProfileId) {
            return false;
        }

        return post.authorId === currentProfileId;
    }

    openEditPostModal(post: CommunityPostDto): void {
        if (this.updatingPost || !this.canEditPost(post)) {
            return;
        }

        this.clearEditPostImageEntries();
        this.editingPostId = post.id;
        this.editPostTitle = post.title ?? '';
        this.editPostLinkUrl = post.linkUrl ?? '';
        this.editPostContent = '';
        this.editPostMediaContent = '';
        this.editPollQuestion = '';
        this.editPollOptions = ['', ''];

        const existingImageUrls = (post.imageUrls ?? []).filter(url => !!url);
        this.editPostImageEntries = existingImageUrls.map(url => ({
            url,
            file: null,
            isObjectUrl: false
        }));
        this.editPostActiveImageIndex = 0;

        if (post.poll) {
            this.editPostTab = 'poll';
            this.editPostContent = post.content ?? '';
            this.editPollQuestion = post.poll.question;
            this.editPollOptions = post.poll.options.map(option => option.text).slice(0, 6);
            while (this.editPollOptions.length < 2) {
                this.editPollOptions.push('');
            }
        } else if ((post.imageUrls?.length ?? 0) > 0 || !!post.imageUrl) {
            this.editPostTab = 'media';
            this.editPostMediaContent = post.content ?? '';
        } else if ((post.linkUrl ?? '').trim()) {
            this.editPostTab = 'link';
            this.editPostMediaContent = post.content ?? '';
        } else {
            this.editPostTab = 'text';
            this.editPostContent = post.content ?? '';
        }

        this.editPostModalOpen = true;
        this.resetStatus();
    }

    closeEditPostModal(): void {
        if (this.updatingPost) {
            return;
        }

        this.editPostModalOpen = false;
        this.editingPostId = null;
        this.clearEditPostImageEntries();
    }

    async submitPostUpdateAsync(): Promise<void> {
        if (!this.communityId || !this.editingPostId || this.updatingPost) {
            return;
        }

        const post = this.posts.find(item => item.id === this.editingPostId);
        if (!post || !this.canEditPost(post)) {
            this.closeEditPostModal();
            return;
        }

        const title = this.editPostTitle.trim() || null;
        const content = this.resolveEditPostContent();
        const linkUrl = this.editPostTab === 'link' ? this.editPostLinkUrl.trim() || null : null;
        const pollQuestion = this.editPostTab === 'poll' ? this.editPollQuestion.trim() || null : null;
        const pollOptions = this.editPostTab === 'poll'
            ? this.editPollOptions.map(option => option.trim()).filter(option => !!option)
            : null;
        const clearPoll = this.editPostTab !== 'poll';

        if (!title) {
            this.status = 'Title is required.';
            this.statusTone = 'neutral';
            return;
        }

        const hasImages = this.editPostTab === 'media' && this.editPostImageEntries.length > 0;

        if (!content && !linkUrl && !hasImages && !pollQuestion) {
            this.status = 'Add text, image, link, or poll before saving.';
            this.statusTone = 'neutral';
            return;
        }

        this.updatingPost = true;
        this.resetStatus();

        try {
            const imageUrls = this.editPostTab === 'media'
                ? await this.resolveEditPostImageUrlsAsync()
                : [];

            const updated = await this.session.updateCommunityPostAsync(
                this.communityId,
                this.editingPostId,
                title,
                linkUrl,
                content,
                this.editPostTab === 'media' ? imageUrls : [],
                pollQuestion,
                pollOptions,
                clearPoll
            );

            this.posts = this.posts.map(item => item.id === updated.id ? updated : item);
            this.editPostModalOpen = false;
            this.editingPostId = null;
            this.clearEditPostImageEntries();
            this.status = 'Post updated.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('update post'));
            this.statusTone = 'error';
        } finally {
            this.updatingPost = false;
        }
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
            || !!this.composerMediaContent.trim()
            || !!this.composerTitle.trim()
            || !!this.composerLinkUrl.trim()
            || this.composerImageFiles.length > 0
            || this.composerTab === 'poll'
            || !!this.pollQuestion.trim()
            || this.pollOptions.some(option => !!option.trim());

        if (!hasDraft) {
            localStorage.removeItem(key);
            return;
        }

        localStorage.setItem(key, JSON.stringify({
            composerTab: this.composerTab,
            composerTitle: this.composerTitle,
            composerContent: this.composerContent,
            composerMediaContent: this.composerMediaContent,
            composerLinkUrl: this.composerLinkUrl,
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
                composerTab?: CommunityComposerTab;
                composerTitle?: string;
                composerContent?: string;
                composerMediaContent?: string;
                composerLinkUrl?: string;
                pollQuestion?: string;
                pollOptions?: string[];
            };

            this.composerTab = parsed.composerTab ?? 'text';
            this.composerTitle = parsed.composerTitle ?? '';
            this.composerContent = parsed.composerContent ?? '';
            this.composerMediaContent = parsed.composerMediaContent ?? '';
            this.composerLinkUrl = parsed.composerLinkUrl ?? '';
            this.composerImageFiles = [];
            this.composerImagePreviewUrls = [];
            this.composerActiveImageIndex = 0;
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

    private resolveComposerPostContent(): string | null {
        const bodySource = this.composerTab === 'text' || this.composerTab === 'poll'
            ? this.composerContent
            : this.composerMediaContent;

        const body = bodySource.trim();
        return body || null;
    }

    private resolveEditPostContent(): string | null {
        const bodySource = this.editPostTab === 'text' || this.editPostTab === 'poll'
            ? this.editPostContent
            : this.editPostMediaContent;

        const body = bodySource.trim();
        return body || null;
    }

    private async resolveEditPostImageUrlsAsync(): Promise<string[]> {
        const urls: string[] = [];

        for (const entry of this.editPostImageEntries) {
            if (entry.file) {
                const uploaded = await this.session.uploadImageAsync(entry.file);
                if (uploaded) {
                    urls.push(uploaded);
                }

                continue;
            }

            const existingUrl = entry.url.trim();
            if (existingUrl) {
                urls.push(existingUrl);
            }
        }

        return urls;
    }

    private clearComposerImages(): void {
        for (const previewUrl of this.composerImagePreviewUrls) {
            if (previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(previewUrl);
            }
        }

        this.composerImageFiles = [];
        this.composerImagePreviewUrls = [];
        this.composerActiveImageIndex = 0;
    }

    private clearEditPostImageEntries(): void {
        for (const entry of this.editPostImageEntries) {
            if (entry.isObjectUrl) {
                URL.revokeObjectURL(entry.url);
            }
        }

        this.editPostImageEntries = [];
        this.editPostActiveImageIndex = 0;
    }

    private resetStatus(): void {
        this.status = '';
        this.statusTone = 'neutral';
    }
}

function stringEqualsIgnoreCase(left: string, right: string): boolean {
    return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}
