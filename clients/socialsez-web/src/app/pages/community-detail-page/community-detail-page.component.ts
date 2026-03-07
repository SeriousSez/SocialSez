import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, HostListener, NgZone, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommunityDto, CommunityMemberDto, CommunityPollDto, CommunityPostDto, CommunityRuleDto, ProfileDto } from '../../core/api.types';
import { rankByDiscoveryQuery, scoreDiscoveryFields } from '../../core/discovery-search.util';
import { HashtagTextPart, splitHashtagText } from '../../core/hashtag-text.util';
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

type MemberModerationAction = 'ban' | 'timeout' | 'unban';

interface PendingMemberModerationAction {
    action: MemberModerationAction;
    profileId: string;
    handle: string;
}

@Component({
    selector: 'app-community-detail-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, ConfirmModalComponent, SkeletonComponent],
    templateUrl: './community-detail-page.component.html',
    styleUrl: './community-detail-page.component.scss'
})
export class CommunityDetailPageComponent {
    readonly timeoutDurationOptions: Array<{ value: 1 | 7 | 30; label: string }> = [
        { value: 1, label: '1 day' },
        { value: 7, label: '7 days' },
        { value: 30, label: '1 month' }
    ];
    selectedTimeoutDurationDays: 1 | 7 | 30 = 7;

    community: CommunityDto | null = null;
    posts: CommunityPostDto[] = [];
    postSearchQuery = '';

    loading = false;
    posting = false;
    createPostModalOpen = false;
    editCommunityModalOpen = false;
    editPostModalOpen = false;
    membersModalOpen = false;
    membersModalTab: 'members' | 'banned' = 'members';
    membersSearchQuery = '';
    bannedProfiles: ProfileDto[] = [];
    loadingBannedProfiles = false;
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
    updatingMemberRoleId: string | null = null;
    pendingMemberModerationAction: PendingMemberModerationAction | null = null;
    moderatingMemberId: string | null = null;
    copiedPostLinkId: string | null = null;
    copiedCommunityLink = false;
    fullscreenImageUrl: string | null = null;
    fullscreenImageUrls: string[] = [];
    fullscreenImageIndex = 0;
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
    updateCommunityRulesText = '';
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
    private readonly postImageIndexByPostId = new Map<string, number>();
    private readonly postImageDirectionByPostId = new Map<string, 'next' | 'prev'>();
    private readonly postImageOutgoingByPostId = new Map<string, string>();
    private readonly postImageAnimatingByPostId = new Set<string>();
    private readonly postImageAnimationTimeoutByPostId = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly postImageAnimationMs = 320;

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

    constructor(public readonly session: SessionService, private readonly route: ActivatedRoute, private readonly router: Router) {
        this.route.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                this.communitySlug = params.get('slug');
                void this.loadAsync();
            });
    }

    get canPost(): boolean {
        return !!this.community?.joinedByMe && !this.isTimedOutInCommunity;
    }

    get isTimedOutInCommunity(): boolean {
        const mutedUntilUtc = this.currentMember?.mutedUntilUtc;
        if (!mutedUntilUtc) {
            return false;
        }

        const mutedUntilMs = Date.parse(mutedUntilUtc);
        return Number.isFinite(mutedUntilMs) && mutedUntilMs > Date.now();
    }

    get timedOutUntilText(): string {
        const mutedUntilUtc = this.currentMember?.mutedUntilUtc;
        if (!mutedUntilUtc) {
            return '';
        }

        const mutedUntilDate = new Date(mutedUntilUtc);
        if (Number.isNaN(mutedUntilDate.getTime())) {
            return '';
        }

        return mutedUntilDate.toLocaleString();
    }

    get canLeave(): boolean {
        return !!this.community?.joinedByMe;
    }

    private get currentMember(): CommunityMemberDto | null {
        const currentProfileId = this.session.profile?.id;
        if (!currentProfileId) {
            return null;
        }

        return this.community?.members.find(member => member.profileId.toLowerCase() === currentProfileId.toLowerCase()) ?? null;
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

    get canManageModerators(): boolean {
        if (!this.community) {
            return false;
        }

        const role = (this.community.myRole ?? '').trim().toLowerCase();
        return role === 'owner' || role === 'admin';
    }

    get filteredMembers(): CommunityMemberDto[] {
        const bannedProfileIds = new Set(this.bannedProfiles.map(profile => profile.id));
        const members = (this.community?.members ?? []).filter(member => !bannedProfileIds.has(member.profileId));

        return rankByDiscoveryQuery(members, {
            query: this.membersSearchQuery,
            minScore: 0,
            score: (member, expandedTerms) => this.memberSearchScore(member, expandedTerms),
            onEmptyQuery: items => [...items].sort((a, b) => {
                const roleCompare = this.memberRoleSortPriority(a.role) - this.memberRoleSortPriority(b.role);
                if (roleCompare !== 0) {
                    return roleCompare;
                }

                return a.handle.localeCompare(b.handle);
            }),
            tieBreaker: (a, b) => {
                const roleCompare = this.memberRoleSortPriority(a.role) - this.memberRoleSortPriority(b.role);
                if (roleCompare !== 0) {
                    return roleCompare;
                }

                return a.handle.localeCompare(b.handle);
            }
        });
    }

    get elevatedMembers(): CommunityMemberDto[] {
        return this.filteredMembers.filter(member => !this.isRegularMemberRole(member.role));
    }

    get regularMembers(): CommunityMemberDto[] {
        return this.filteredMembers.filter(member => this.isRegularMemberRole(member.role));
    }

    get filteredBannedProfiles(): ProfileDto[] {
        return rankByDiscoveryQuery(this.bannedProfiles, {
            query: this.membersSearchQuery,
            minScore: 0,
            score: (profile, expandedTerms) => this.profileSearchScore(profile, expandedTerms),
            onEmptyQuery: items => [...items].sort((a, b) => a.handle.localeCompare(b.handle)),
            tieBreaker: (a, b) => a.handle.localeCompare(b.handle)
        });
    }

    canPromoteToModerator(member: { profileId: string; role: string }): boolean {
        if (!this.canManageModerators || !this.community) {
            return false;
        }

        if (member.profileId === this.session.profile?.id) {
            return false;
        }

        const role = (member.role ?? '').trim().toLowerCase();
        return role === 'member';
    }

    canDemoteModerator(member: { profileId: string; role: string }): boolean {
        if (!this.canManageModerators || !this.community) {
            return false;
        }

        if (member.profileId === this.session.profile?.id) {
            return false;
        }

        const role = (member.role ?? '').trim().toLowerCase();
        return role === 'moderator';
    }

    canBanMember(member: CommunityMemberDto): boolean {
        if (!this.canManageModerators || !this.community) {
            return false;
        }

        if (member.profileId === this.session.profile?.id) {
            return false;
        }

        const role = (member.role ?? '').trim().toLowerCase();
        return role !== 'owner' && role !== 'admin';
    }

    canTimeoutMember(member: CommunityMemberDto): boolean {
        return this.canBanMember(member);
    }

    async promoteMemberToModeratorAsync(memberProfileId: string): Promise<void> {
        if (!this.communityId || this.updatingMemberRoleId) {
            return;
        }

        this.updatingMemberRoleId = memberProfileId;
        this.resetStatus();

        try {
            this.community = await this.session.updateCommunityMemberRoleAsync(this.communityId, memberProfileId, 'Moderator');
            this.status = 'Member promoted to moderator.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('promote member'));
            this.statusTone = 'error';
        } finally {
            this.updatingMemberRoleId = null;
        }
    }

    async demoteModeratorAsync(memberProfileId: string): Promise<void> {
        if (!this.communityId || this.updatingMemberRoleId) {
            return;
        }

        this.updatingMemberRoleId = memberProfileId;
        this.resetStatus();

        try {
            this.community = await this.session.updateCommunityMemberRoleAsync(this.communityId, memberProfileId, 'Member');
            this.status = 'Moderator role removed.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('remove moderator'));
            this.statusTone = 'error';
        } finally {
            this.updatingMemberRoleId = null;
        }
    }

    requestBanMember(member: CommunityMemberDto): void {
        if (!this.canBanMember(member) || this.moderatingMemberId) {
            return;
        }

        this.pendingMemberModerationAction = {
            action: 'ban',
            profileId: member.profileId,
            handle: member.handle
        };
    }

    requestTimeoutMember(member: CommunityMemberDto): void {
        if (!this.canTimeoutMember(member) || this.moderatingMemberId) {
            return;
        }

        this.selectedTimeoutDurationDays = 7;

        this.pendingMemberModerationAction = {
            action: 'timeout',
            profileId: member.profileId,
            handle: member.handle
        };
    }

    requestUnbanProfile(profile: ProfileDto): void {
        if (!this.canManageModerators || this.moderatingMemberId) {
            return;
        }

        this.pendingMemberModerationAction = {
            action: 'unban',
            profileId: profile.id,
            handle: profile.handle
        };
    }

    cancelMemberModerationAction(): void {
        if (this.moderatingMemberId) {
            return;
        }

        this.pendingMemberModerationAction = null;
    }

    async confirmMemberModerationActionAsync(): Promise<void> {
        if (!this.pendingMemberModerationAction || this.moderatingMemberId) {
            return;
        }

        const { action, profileId, handle } = this.pendingMemberModerationAction;
        this.moderatingMemberId = profileId;
        this.resetStatus();

        try {
            if (action === 'ban') {
                await this.session.blockProfileAsync(profileId);
                this.status = `@${handle} has been banned.`;

                if (!this.bannedProfiles.some(profile => profile.id === profileId)) {
                    this.bannedProfiles = [
                        {
                            id: profileId,
                            handle,
                            displayName: handle,
                            bio: '',
                            isPrivate: false,
                            createdAtUtc: new Date(0).toISOString()
                        },
                        ...this.bannedProfiles
                    ];
                }
            } else if (action === 'unban') {
                await this.session.unblockProfileAsync(profileId);
                this.status = `@${handle} has been unbanned.`;
                this.bannedProfiles = this.bannedProfiles.filter(profile => profile.id !== profileId);
            } else {
                if (!this.communityId) {
                    throw new Error('Community not loaded.');
                }

                this.community = await this.session.timeoutCommunityMemberAsync(this.communityId, profileId, this.selectedTimeoutDurationDays);
                const timeoutLabel = this.selectedTimeoutDurationDays === 30 ? '1 month' : `${this.selectedTimeoutDurationDays} day${this.selectedTimeoutDurationDays === 1 ? '' : 's'}`;
                this.status = `@${handle} has been timed out for ${timeoutLabel}.`;
            }

            this.statusTone = 'success';
            this.pendingMemberModerationAction = null;
        } catch (error) {
            const activity = action === 'ban'
                ? 'ban member'
                : action === 'unban'
                    ? 'unban member'
                    : 'timeout member';
            this.status = toUserErrorMessage(error, actionError(activity));
            this.statusTone = 'error';
        } finally {
            this.moderatingMemberId = null;
        }
    }

    get memberModerationModalTitle(): string {
        if (!this.pendingMemberModerationAction) {
            return 'Confirm action';
        }

        if (this.pendingMemberModerationAction.action === 'ban') {
            return 'Ban user';
        }

        if (this.pendingMemberModerationAction.action === 'unban') {
            return 'Unban user';
        }

        return 'Timeout user';
    }

    get memberModerationModalMessage(): string {
        if (!this.pendingMemberModerationAction) {
            return '';
        }

        const handle = this.pendingMemberModerationAction.handle;
        if (this.pendingMemberModerationAction.action === 'ban') {
            return `Ban @${handle}? This blocks them from your account.`;
        }

        if (this.pendingMemberModerationAction.action === 'unban') {
            return `Unban @${handle}? This removes the block from your account.`;
        }

        const timeoutLabel = this.selectedTimeoutDurationDays === 30 ? '1 month' : `${this.selectedTimeoutDurationDays} day${this.selectedTimeoutDurationDays === 1 ? '' : 's'}`;
        return `Timeout @${handle} for ${timeoutLabel}? During timeout they cannot post or comment in this community.`;
    }

    get memberModerationConfirmText(): string {
        if (!this.pendingMemberModerationAction) {
            return 'Confirm';
        }

        if (this.pendingMemberModerationAction.action === 'ban') {
            return 'Ban user';
        }

        if (this.pendingMemberModerationAction.action === 'unban') {
            return 'Unban user';
        }

        return 'Timeout user';
    }

    async loadAsync(): Promise<void> {
        if (!this.communitySlug) {
            this.community = null;
            this.posts = [];
            this.membersModalOpen = false;
            return;
        }

        this.loading = true;
        this.resetStatus();

        try {
            const community = await this.session.getCommunityBySlugAsync(this.communitySlug, 1000);

            if (!community) {
                this.community = null;
                this.communityId = null;
                this.posts = [];
                this.membersModalOpen = false;
                this.status = 'Community was not found.';
                this.statusTone = 'neutral';
                return;
            }

            this.communityId = community.id;
            const posts = await this.loadCommunityPostsForSearchAsync(community.id, this.postSearchQuery);

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
        if (!this.session.isAuthenticated()) {
            this.session.message = 'Please sign in or create an account to join this community.';
            await this.router.navigate(['/auth']);
            return;
        }

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

        const communityUrl = `${window.location.origin}/c/${encodeURIComponent(slug)}`;

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
        this.updateCommunityRulesText = (this.community.rules ?? [])
            .map(rule => rule.text)
            .join('\n');
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

    async openMembersModal(): Promise<void> {
        if (!this.community) {
            return;
        }

        this.membersModalTab = 'members';
        this.membersSearchQuery = '';
        this.membersModalOpen = true;

        if (this.canManageModerators) {
            await this.loadBannedProfilesAsync();
        }
    }

    closeMembersModal(): void {
        this.membersModalTab = 'members';
        this.membersSearchQuery = '';
        this.pendingMemberModerationAction = null;
        this.membersModalOpen = false;
    }

    setMembersModalTab(tab: 'members' | 'banned'): void {
        this.membersModalTab = tab;
        this.membersSearchQuery = '';
        if (tab === 'banned' && this.canManageModerators && !this.loadingBannedProfiles && this.bannedProfiles.length === 0) {
            void this.loadBannedProfilesAsync();
        }
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
                this.parseRulesText(this.updateCommunityRulesText),
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
                await this.router.navigate(['/c', updated.slug], { replaceUrl: true });
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

        const content = this.resolveComposerTextContent();
        const mediaContent = this.resolveComposerMediaContent();
        const title = this.composerTitle.trim() || null;
        const normalizedLink = this.normalizeOptionalHttpUrl(this.composerLinkUrl);
        if (normalizedLink.error) {
            this.status = normalizedLink.error;
            this.statusTone = 'neutral';
            return;
        }

        const linkUrl = normalizedLink.value;
        const pollQuestion = this.composerTab === 'poll' ? this.pollQuestion.trim() || null : null;
        const pollOptions = this.composerTab === 'poll'
            ? this.pollOptions.map(option => option.trim()).filter(option => !!option)
            : null;
        const selectedImages = [...this.composerImageFiles];

        if (!title) {
            this.status = 'Title is required.';
            this.statusTone = 'neutral';
            return;
        }

        if (!content && !mediaContent && !linkUrl && selectedImages.length === 0 && !pollQuestion) {
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
                mediaContent,
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
        if (!this.session.isAuthenticated()) {
            this.session.message = 'Please sign in or create an account to create a community post.';
            void this.router.navigate(['/auth']);
            return;
        }

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
            this.posts = await this.loadCommunityPostsForSearchAsync(this.communityId, this.postSearchQuery);
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
        const postUrl = `${window.location.origin}/cp/${post.id}`;

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
        await this.router.navigate(['/cp', postId]);
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

    shouldShowPollResults(poll: CommunityPollDto): boolean {
        if (poll.hasVotedByMe) {
            return true;
        }

        return (poll.options ?? []).some(option => option.votedByMe);
    }

    getPollOptionPercentage(poll: CommunityPollDto, voteCount: number): number {
        const totalVotes = poll.totalVotes ?? 0;
        if (totalVotes <= 0) {
            return 0;
        }

        return Math.round((voteCount / totalVotes) * 100);
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

    getPostTextBody(post: CommunityPostDto): string | null {
        const textBody = post.content?.trim();
        return textBody || null;
    }

    getPostMediaCaption(post: CommunityPostDto): string | null {
        const mediaBody = post.mediaContent?.trim();
        return mediaBody || null;
    }

    getPostMediaUrls(post: CommunityPostDto): string[] {
        const fromArray = (post.imageUrls ?? [])
            .map(url => url?.trim())
            .filter((url): url is string => !!url);

        if (fromArray.length > 0) {
            return fromArray;
        }

        const single = post.imageUrl?.trim();
        return single ? [single] : [];
    }

    getActivePostImageUrl(post: CommunityPostDto): string | null {
        const urls = this.getPostMediaUrls(post);
        if (!urls.length) {
            return null;
        }

        const rawIndex = this.postImageIndexByPostId.get(post.id) ?? 0;
        const safeIndex = Math.min(Math.max(rawIndex, 0), urls.length - 1);
        if (safeIndex !== rawIndex) {
            this.postImageIndexByPostId.set(post.id, safeIndex);
        }

        return urls[safeIndex] ?? null;
    }

    canMovePostImageBack(post: CommunityPostDto): boolean {
        const index = this.postImageIndexByPostId.get(post.id) ?? 0;
        return index > 0;
    }

    canMovePostImageForward(post: CommunityPostDto): boolean {
        const index = this.postImageIndexByPostId.get(post.id) ?? 0;
        return index < this.getPostMediaUrls(post).length - 1;
    }

    showPreviousPostImage(post: CommunityPostDto, event: Event): void {
        event.stopPropagation();
        const index = this.postImageIndexByPostId.get(post.id) ?? 0;
        if (index <= 0) {
            return;
        }

        this.transitionPostImage(post, index - 1, 'prev');
    }

    showNextPostImage(post: CommunityPostDto, event: Event): void {
        event.stopPropagation();
        const index = this.postImageIndexByPostId.get(post.id) ?? 0;
        const maxIndex = this.getPostMediaUrls(post).length - 1;
        if (index >= maxIndex) {
            return;
        }

        this.transitionPostImage(post, index + 1, 'next');
    }

    onPostImageCardClick(post: CommunityPostDto, imageUrl: string, event: Event): void {
        event.stopPropagation();

        const urls = this.getPostMediaUrls(post);
        if (urls.length <= 1) {
            this.openImageFullscreen(post, imageUrl, event);
            return;
        }

        const index = this.postImageIndexByPostId.get(post.id) ?? 0;
        const nextIndex = index >= urls.length - 1 ? 0 : index + 1;
        this.transitionPostImage(post, nextIndex, 'next');
    }

    setActivePostImage(post: CommunityPostDto, index: number, event: Event): void {
        event.stopPropagation();
        if (index < 0 || index >= this.getPostMediaUrls(post).length) {
            return;
        }

        const currentIndex = this.postImageIndexByPostId.get(post.id) ?? 0;
        if (index === currentIndex) {
            return;
        }

        this.transitionPostImage(post, index, index > currentIndex ? 'next' : 'prev');
    }

    getPostActiveImageIndex(post: CommunityPostDto): number {
        const maxIndex = Math.max(0, this.getPostMediaUrls(post).length - 1);
        const rawIndex = this.postImageIndexByPostId.get(post.id) ?? 0;
        const safeIndex = Math.min(Math.max(rawIndex, 0), maxIndex);
        if (safeIndex !== rawIndex) {
            this.postImageIndexByPostId.set(post.id, safeIndex);
        }

        return safeIndex;
    }

    trackByMediaUrl(_index: number, mediaUrl: string): string {
        return mediaUrl;
    }

    trackByIndex(index: number): number {
        return index;
    }

    getPostImageDirection(post: CommunityPostDto): 'next' | 'prev' {
        return this.postImageDirectionByPostId.get(post.id) ?? 'next';
    }

    isPostImageAnimating(post: CommunityPostDto): boolean {
        return this.postImageAnimatingByPostId.has(post.id);
    }

    getPostOutgoingImageUrl(post: CommunityPostDto): string | null {
        return this.postImageOutgoingByPostId.get(post.id) ?? null;
    }

    private transitionPostImage(post: CommunityPostDto, nextIndex: number, direction: 'next' | 'prev'): void {
        const urls = this.getPostMediaUrls(post);
        if (!urls.length) {
            return;
        }

        const safeNextIndex = Math.min(Math.max(nextIndex, 0), urls.length - 1);
        const currentIndex = this.postImageIndexByPostId.get(post.id) ?? 0;
        if (safeNextIndex === currentIndex) {
            return;
        }

        const currentUrl = this.getActivePostImageUrl(post);
        this.postImageDirectionByPostId.set(post.id, direction);

        const pendingTimeout = this.postImageAnimationTimeoutByPostId.get(post.id);
        if (pendingTimeout) {
            clearTimeout(pendingTimeout);
            this.postImageAnimationTimeoutByPostId.delete(post.id);
        }

        if (currentUrl) {
            this.postImageOutgoingByPostId.set(post.id, currentUrl);
            this.postImageAnimatingByPostId.add(post.id);
        }

        this.postImageIndexByPostId.set(post.id, safeNextIndex);

        const timeoutId = setTimeout(() => {
            this.postImageAnimatingByPostId.delete(post.id);
            this.postImageOutgoingByPostId.delete(post.id);
            this.postImageAnimationTimeoutByPostId.delete(post.id);
            this.cdr.detectChanges();
        }, this.postImageAnimationMs);

        this.postImageAnimationTimeoutByPostId.set(post.id, timeoutId);
    }

    openPostFromCommentAction(postId: string, event: Event): void {
        event.stopPropagation();
        void this.openPostAsync(postId);
    }

    openImageFullscreen(post: CommunityPostDto, imageUrl: string, event: Event): void {
        event.stopPropagation();
        const urls = this.getPostMediaUrls(post);
        if (!urls.length) {
            this.fullscreenImageUrls = [];
            this.fullscreenImageIndex = 0;
            this.fullscreenImageUrl = imageUrl;
            return;
        }

        const clickedIndex = urls.findIndex(url => url === imageUrl);
        const fallbackIndex = this.getPostActiveImageIndex(post);
        this.fullscreenImageIndex = clickedIndex >= 0 ? clickedIndex : fallbackIndex;
        this.fullscreenImageUrls = urls;
        this.fullscreenImageUrl = urls[this.fullscreenImageIndex] ?? imageUrl;
    }

    get canMoveFullscreenImageBack(): boolean {
        return this.fullscreenImageIndex > 0;
    }

    get canMoveFullscreenImageForward(): boolean {
        return this.fullscreenImageIndex < this.fullscreenImageUrls.length - 1;
    }

    showPreviousFullscreenImage(event?: Event): void {
        event?.stopPropagation();
        if (!this.canMoveFullscreenImageBack) {
            return;
        }

        this.fullscreenImageIndex -= 1;
        this.fullscreenImageUrl = this.fullscreenImageUrls[this.fullscreenImageIndex] ?? this.fullscreenImageUrl;
    }

    showNextFullscreenImage(event?: Event): void {
        event?.stopPropagation();
        if (!this.canMoveFullscreenImageForward) {
            return;
        }

        this.fullscreenImageIndex += 1;
        this.fullscreenImageUrl = this.fullscreenImageUrls[this.fullscreenImageIndex] ?? this.fullscreenImageUrl;
    }

    closeImageFullscreen(): void {
        this.fullscreenImageUrl = null;
        this.fullscreenImageUrls = [];
        this.fullscreenImageIndex = 0;
    }

    @HostListener('document:keydown', ['$event'])
    onDocumentKeydown(event: KeyboardEvent): void {
        if (!this.fullscreenImageUrl && !this.membersModalOpen) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.fullscreenImageUrl) {
                this.closeImageFullscreen();
                return;
            }

            if (this.membersModalOpen) {
                this.closeMembersModal();
            }
            return;
        }

        if (!this.fullscreenImageUrl) {
            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.showPreviousFullscreenImage();
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.showNextFullscreenImage();
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
        return role === 'Owner' || role === 'Admin' || role === 'Moderator';
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
        this.editPostContent = post.content ?? '';
        this.editPostMediaContent = post.mediaContent ?? post.content ?? '';
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
            this.editPollQuestion = post.poll.question;
            this.editPollOptions = post.poll.options.map(option => option.text).slice(0, 6);
            while (this.editPollOptions.length < 2) {
                this.editPollOptions.push('');
            }
        } else if ((post.imageUrls?.length ?? 0) > 0 || !!post.imageUrl) {
            this.editPostTab = 'media';
        } else if ((post.linkUrl ?? '').trim()) {
            this.editPostTab = 'link';
        } else {
            this.editPostTab = 'text';
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
        const content = this.resolveEditPostTextContent();
        const mediaContent = this.resolveEditPostMediaContent();
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

        if (!content && !mediaContent && !linkUrl && !hasImages && !pollQuestion) {
            this.status = 'Add text, image, link, or poll before saving.';
            this.statusTone = 'neutral';
            return;
        }

        this.updatingPost = true;
        this.resetStatus();

        try {
            const imageUrls = this.editPostTab === 'media'
                ? await this.resolveEditPostImageUrlsAsync()
                : null;

            const updated = await this.session.updateCommunityPostAsync(
                this.communityId,
                this.editingPostId,
                title,
                linkUrl,
                content,
                mediaContent,
                imageUrls,
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

    splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
        return splitHashtagText(content);
    }

    trackByMemberProfileId(_index: number, member: CommunityMemberDto): string {
        return member.profileId;
    }

    trackByProfileId(_index: number, profile: ProfileDto): string {
        return profile.id;
    }

    memberAvatarText(member: CommunityMemberDto): string {
        const source = member.handle?.trim();
        return source ? source[0].toUpperCase() : 'U';
    }

    profileAvatarText(profile: ProfileDto): string {
        const source = profile.displayName?.trim() || profile.handle?.trim();
        return source ? source[0].toUpperCase() : 'U';
    }

    private memberRoleSortPriority(role: string): number {
        const normalized = (role ?? '').trim().toLowerCase();
        if (normalized === 'owner') {
            return 0;
        }

        if (normalized === 'moderator') {
            return 1;
        }

        if (normalized === 'admin') {
            return 2;
        }

        return 3;
    }

    private isRegularMemberRole(role: string): boolean {
        return (role ?? '').trim().toLowerCase() === 'member';
    }

    private async loadBannedProfilesAsync(): Promise<void> {
        if (this.loadingBannedProfiles || !this.canManageModerators) {
            return;
        }

        this.loadingBannedProfiles = true;

        try {
            this.bannedProfiles = await this.session.loadBlockedProfilesAsync(500);
        } catch {
            this.bannedProfiles = [];
        } finally {
            this.loadingBannedProfiles = false;
        }
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

    private resolveComposerTextContent(): string | null {
        return this.composerContent.trim() || null;
    }

    private resolveComposerMediaContent(): string | null {
        return this.composerMediaContent.trim() || null;
    }

    private normalizeOptionalHttpUrl(raw: string): { value: string | null; error?: string } {
        const trimmed = raw.trim();
        if (!trimmed) {
            return { value: null };
        }

        const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

        try {
            const parsed = new URL(candidate);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return { value: null, error: 'Link URL must start with http:// or https://.' };
            }

            return { value: parsed.toString() };
        } catch {
            return { value: null, error: 'Enter a valid link URL.' };
        }
    }

    private resolveEditPostTextContent(): string | null {
        return this.editPostContent.trim() || null;
    }

    private resolveEditPostMediaContent(): string | null {
        return this.editPostMediaContent.trim() || null;
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

    private parseRulesText(rulesText: string): CommunityRuleDto[] {
        return (rulesText ?? '')
            .split('\n')
            .map(rule => rule.trim())
            .filter(rule => !!rule)
            .map(rule => ({ text: rule }));
    }

    private memberSearchScore(member: CommunityMemberDto, expandedTerms: ReadonlyArray<string>): number {
        return scoreDiscoveryFields(expandedTerms, [
            { value: member.handle, weight: 1.4 },
            { value: member.role, weight: 1.0 }
        ]);
    }

    private profileSearchScore(profile: ProfileDto, expandedTerms: ReadonlyArray<string>): number {
        return scoreDiscoveryFields(expandedTerms, [
            { value: profile.handle, weight: 1.4 },
            { value: profile.displayName, weight: 1.3 },
            { value: profile.bio, weight: 1.0 }
        ]);
    }

    private postSearchScore(post: CommunityPostDto, expandedTerms: ReadonlyArray<string>): number {
        return scoreDiscoveryFields(expandedTerms, [
            { value: post.title, weight: 1.8 },
            { value: post.content, weight: 1.4 },
            { value: post.authorHandle, weight: 1.0 },
            { value: post.linkUrl, weight: 1.1 }
        ]);
    }

    private rankCommunityPosts(posts: ReadonlyArray<CommunityPostDto>, query: string): CommunityPostDto[] {
        return rankByDiscoveryQuery(posts, {
            query,
            minScore: 0,
            score: (post, expandedTerms) => this.postSearchScore(post, expandedTerms),
            onEmptyQuery: items => [...items],
            tieBreaker: (left, right) => this.toTimestamp(right.createdAtUtc) - this.toTimestamp(left.createdAtUtc)
        });
    }

    private async loadCommunityPostsForSearchAsync(communityId: string, query: string): Promise<CommunityPostDto[]> {
        const trimmed = query.trim();
        if (!trimmed) {
            return await this.session.loadCommunityPostsAsync(communityId, undefined);
        }

        const directMatches = await this.session.loadCommunityPostsAsync(communityId, trimmed);
        const rankedDirect = this.rankCommunityPosts(directMatches, trimmed);
        if (rankedDirect.length > 0) {
            return rankedDirect;
        }

        const allPosts = await this.session.loadCommunityPostsAsync(communityId, undefined);
        return this.rankCommunityPosts(allPosts, trimmed);
    }

    private toTimestamp(value: string): number {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    private resetStatus(): void {
        this.status = '';
        this.statusTone = 'neutral';
    }
}

function stringEqualsIgnoreCase(left: string, right: string): boolean {
    return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}
