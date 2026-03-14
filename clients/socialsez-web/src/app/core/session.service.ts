import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ReplaySubject, Subject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
    AuthSessionDto,
    AuthResponse,
    BlogDto,
    BlogPostDto,
    BlogThemeConfigDto,
    ChatConversationDto,
    CommunityRuleDto,
    ChatMessageDto,
    CommunityDto,
    CommunityPollDto,
    CommunityPostDto,
    FeedMode,
    FollowActionResultDto,
    FollowRequestDto,
    FollowedHashtagDto,
    FollowStatusDto,
    FollowSuggestionsDto,
    HashtagBlogDto,
    HashtagBlogPostDto,
    HashtagCommunityDto,
    HashtagCommunityPostDto,
    HashtagContentDto,
    HashtagReelDto,
    HashtagSearchResultDto,
    LoginRequest,
    NotificationDto,
    PostDto,
    ProfileActivitySummaryDto,
    ProfileDto,
    ReelDto,
    RegisterRequest,
    SafetyStatusDto,
    StoryDto,
    StoryCollectionDto,
    StoryGroupDto,
    UpdateProfileRequest,
    SavedCollectionDto,
    SavedItemDto,
    SavedStatusDto
} from './api.types';
import { SocialSezApiService } from './socialsez-api.service';

export interface SessionNoticeEntry {
    id: number;
    message: string;
    isError: boolean;
    createdAtUtc: string;
}

export type SaveToCollectionTargetKind = 'post' | 'reel' | 'community-post' | 'blog-post';

export interface SaveToCollectionRequest {
    kind: SaveToCollectionTargetKind;
    itemId: string;
    communityId?: string;
    blogId?: string;
    label?: string;
}

export interface PendingSaveToCollectionRequest extends SaveToCollectionRequest {
    resolve: (saved: boolean) => void;
}

export interface OpenReelInModalRequest {
    reel: ReelDto;
    collectionId?: string;
    savedItemId?: string;
    onRemoveFromCollection?: () => Promise<boolean>;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
    profile: ProfileDto | null = null;
    private _message = '';
    private _messageVersion = 0;
    private readonly maxNoticeHistory = 20;
    private readonly errorMessagePattern = /(error|failed|could not|unable to|invalid|denied|forbidden|unauthorized|not found|expired)/i;
    private _noticeHistory: SessionNoticeEntry[] = [];
    private readonly messageChanges = new ReplaySubject<number>(1);
    nextSilentRefreshAt: Date | null = null;
    private readonly apiOrigin = this.resolveApiOrigin();

    private readonly appChanges = new ReplaySubject<'profile' | 'posts' | 'session' | 'notifications'>(1);
    readonly appChanges$ = this.appChanges.asObservable();
    readonly messageChanges$ = this.messageChanges.asObservable();
    private readonly openReelInModalSource = new Subject<OpenReelInModalRequest>();
    readonly openReelInModal$ = this.openReelInModalSource.asObservable();
    private readonly openSaveToCollectionModalSource = new Subject<PendingSaveToCollectionRequest>();
    readonly openSaveToCollectionModal$ = this.openSaveToCollectionModalSource.asObservable();

    requestOpenReelInModal(request: OpenReelInModalRequest): void {
        this.openReelInModalSource.next(request);
    }

    openSaveToCollectionModalAsync(request: SaveToCollectionRequest): Promise<boolean> {
        if (!this.isAuthenticated()) {
            this.message = 'Sign in to save items.';
            return Promise.resolve(false);
        }

        return new Promise(resolve => {
            this.openSaveToCollectionModalSource.next({ ...request, resolve });
        });
    }

    private silentRefreshTimerId: number | undefined;
    private bootstrapPromise: Promise<void> | null = null;
    private bootstrapped = false;
    // Saved collections state (populated on demand)
    savedPostIds = new Map<string, string>();  // postId → savedItemId
    savedReelIds = new Map<string, string>();  // reelId → savedItemId
    savedStatusLoaded = false;

    constructor(
        private readonly api: SocialSezApiService,
        private readonly router: Router,
        private readonly ngZone: NgZone,
    ) { }

    get message(): string {
        return this._message;
    }

    set message(value: string) {
        this._message = value ?? '';
        this._messageVersion += 1;
        this.addNoticeHistoryEntry(this._message, this._messageVersion);
        this.ngZone.run(() => this.messageChanges.next(this._messageVersion));
    }

    get messageVersion(): number {
        return this._messageVersion;
    }

    get noticeHistory(): readonly SessionNoticeEntry[] {
        return this._noticeHistory;
    }

    isAuthenticated(): boolean {
        return this.api.isAuthenticated();
    }

    async bootstrapAsync(): Promise<void> {
        if (this.bootstrapped) {
            return;
        }

        if (this.bootstrapPromise) {
            await this.bootstrapPromise;
            return;
        }

        this.bootstrapPromise = this.bootstrapInternalAsync();
        await this.bootstrapPromise;
    }

    private async bootstrapInternalAsync(): Promise<void> {
        if (!this.api.isAuthenticated()) {
            this.bootstrapped = true;
            this.bootstrapPromise = null;
            return;
        }

        try {
            const auth = await firstValueFrom(this.api.refreshSession());
            this.applyAuth(auth);
            this.emitAppChange('session');
        } catch {
            this.clearSession();
        } finally {
            this.bootstrapped = true;
            this.bootstrapPromise = null;
        }
    }

    async registerAsync(request: RegisterRequest, navigateToFeed = true): Promise<void> {
        const auth = await firstValueFrom(this.api.register(request));
        this.applyAuth(auth);
        this.message = `Registered as ${auth.profile.handle}.`;
        this.emitAppChange('session');
        if (navigateToFeed) {
            await this.router.navigateByUrl('/feed');
        }
    }

    async loginAsync(request: LoginRequest, staySignedIn = true): Promise<void> {
        const auth = await firstValueFrom(this.api.login(request, staySignedIn));
        this.applyAuth(auth);
        this.message = 'Logged in.';
        this.emitAppChange('session');
        await this.router.navigateByUrl('/feed');
    }

    async logoutAsync(): Promise<void> {
        try {
            await firstValueFrom(this.api.revokeSession());
        } finally {
            this.clearSession();
            this.message = 'Logged out.';
            this.emitAppChange('session');
            await this.router.navigateByUrl('/auth');
        }
    }

    async refreshSessionAsync(silent = false): Promise<void> {
        const auth = await firstValueFrom(this.api.refreshSession());
        this.applyAuth(auth);
        if (!silent) {
            this.message = 'Session restored.';
            this.emitAppChange('session');
        }
    }

    async loadAuthSessionsAsync(): Promise<AuthSessionDto[]> {
        return firstValueFrom(this.api.getAuthSessions());
    }

    async revokeAuthSessionByIdAsync(sessionId: string): Promise<void> {
        await firstValueFrom(this.api.revokeAuthSessionById(sessionId));
    }

    async revokeOtherAuthSessionsAsync(): Promise<number> {
        const response = await firstValueFrom(this.api.revokeOtherAuthSessions());
        return response.revokedCount;
    }

    async deactivateMyAccountAsync(): Promise<void> {
        await firstValueFrom(this.api.deactivateMyAccount());
    }

    async deleteMyAccountAsync(): Promise<void> {
        await firstValueFrom(this.api.deleteMyAccount());
    }

    async loadFeedAsync(mode: FeedMode = 'for-you'): Promise<PostDto[]> {
        const feed = await firstValueFrom(this.api.getFeed(25, mode));
        return feed.map(post => this.normalizePost(post));
    }

    async loadStoryFeedAsync(takeAuthors = 25, mode: FeedMode = 'for-you'): Promise<StoryGroupDto[]> {
        const groups = await firstValueFrom(this.api.getStoryFeed(takeAuthors, mode));
        return groups.map(group => this.normalizeStoryGroup(group));
    }

    async markStoryViewedAsync(storyId: string): Promise<void> {
        await firstValueFrom(this.api.markStoryViewed(storyId));
        this.emitAppChange('posts');
    }

    async deleteStoryAsync(storyId: string): Promise<void> {
        await firstValueFrom(this.api.deleteStory(storyId));
        this.message = 'Story deleted.';
        this.emitAppChange('posts');
    }

    async loadReelFeedAsync(take = 20, mode: FeedMode = 'for-you'): Promise<ReelDto[]> {
        const reels = await firstValueFrom(this.api.getReelFeed(take, mode));
        return reels.map(reel => this.normalizeReel(reel));
    }

    async loadReelsByAuthorHandleAsync(handle: string, take = 25): Promise<ReelDto[]> {
        const reels = await firstValueFrom(this.api.getReelsByAuthorHandle(handle, take));
        return reels.map(reel => this.normalizeReel(reel));
    }

    async loadPublicReelsByAuthorHandleAsync(handle: string, take = 25): Promise<ReelDto[]> {
        const reels = await firstValueFrom(this.api.getPublicReelsByAuthorHandle(handle, take));
        return reels.map(reel => this.normalizeReel(reel));
    }

    async loadPublicReelByIdAsync(reelId: string): Promise<ReelDto | null> {
        const normalized = reelId.trim();
        if (!normalized) {
            return null;
        }

        try {
            const reel = await firstValueFrom(this.api.getPublicReel(normalized));
            return this.normalizeReel(reel);
        } catch {
            return null;
        }
    }

    async loadPublicStoriesByAuthorHandleAsync(handle: string): Promise<StoryGroupDto | null> {
        try {
            const storyGroup = await firstValueFrom(this.api.getPublicStoriesByAuthorHandle(handle));
            const normalizedGroup = this.normalizeStoryGroup(storyGroup);
            return normalizedGroup.stories.length > 0 ? normalizedGroup : null;
        } catch {
            return null;
        }
    }

    async loadPublicStoryByIdAsync(storyId: string): Promise<StoryDto | null> {
        const normalized = storyId.trim();
        if (!normalized) {
            return null;
        }

        try {
            const story = await firstValueFrom(this.api.getPublicStory(normalized));
            return this.normalizeStory(story);
        } catch {
            return null;
        }
    }

    async loadMyStoriesAsync(includeExpired = true, take = 200): Promise<StoryDto[]> {
        const stories = await firstValueFrom(this.api.getMyStories(includeExpired, take));
        return stories.map(story => this.normalizeStory(story));
    }

    async loadPublicStoryCollectionsByAuthorHandleAsync(handle: string): Promise<StoryCollectionDto[]> {
        const collections = await firstValueFrom(this.api.getPublicStoryCollectionsByAuthorHandle(handle));
        return collections.map(collection => ({
            ...collection,
            stories: (collection.stories ?? []).map(story => this.normalizeStory(story))
        }));
    }

    async createStoryCollectionAsync(name: string): Promise<StoryCollectionDto> {
        const created = await firstValueFrom(this.api.createStoryCollection(name));
        this.message = 'Story collection created.';
        return {
            ...created,
            stories: (created.stories ?? []).map(story => this.normalizeStory(story))
        };
    }

    async deleteStoryCollectionAsync(collectionId: string): Promise<void> {
        await firstValueFrom(this.api.deleteStoryCollection(collectionId));
        this.message = 'Story collection deleted.';
    }

    async addStoryToCollectionAsync(collectionId: string, storyId: string): Promise<StoryCollectionDto> {
        const updated = await firstValueFrom(this.api.addStoryToCollection(collectionId, storyId));
        this.message = 'Story added to collection.';
        return {
            ...updated,
            stories: (updated.stories ?? []).map(story => this.normalizeStory(story))
        };
    }

    async removeStoryFromCollectionAsync(collectionId: string, storyId: string): Promise<StoryCollectionDto> {
        const updated = await firstValueFrom(this.api.removeStoryFromCollection(collectionId, storyId));
        this.message = 'Story removed from collection.';
        return {
            ...updated,
            stories: (updated.stories ?? []).map(story => this.normalizeStory(story))
        };
    }

    async toggleReelLikeAsync(reelId: string): Promise<ReelDto> {
        const updated = await firstValueFrom(this.api.toggleReelLike(reelId));
        return this.normalizeReel(updated);
    }

    async addReelCommentAsync(reelId: string, content: string, parentCommentId?: string | null): Promise<ReelDto> {
        const updated = await firstValueFrom(this.api.addReelComment(reelId, content, parentCommentId));
        return this.normalizeReel(updated);
    }

    async updateReelCommentAsync(reelId: string, commentId: string, content: string): Promise<ReelDto> {
        const updated = await firstValueFrom(this.api.updateReelComment(reelId, commentId, content));
        return this.normalizeReel(updated);
    }

    async deleteReelCommentAsync(reelId: string, commentId: string): Promise<ReelDto> {
        const updated = await firstValueFrom(this.api.deleteReelComment(reelId, commentId));
        return this.normalizeReel(updated);
    }

    async loadPostsByHashtagAsync(hashtag: string): Promise<PostDto[]> {
        const posts = await firstValueFrom(this.api.getPostsByHashtag(hashtag));
        return posts.map(post => this.normalizePost(post));
    }

    async loadHashtagContentAsync(hashtag: string): Promise<HashtagContentDto> {
        const content = await firstValueFrom(this.api.getHashtagContent(hashtag));
        return {
            posts: (content.posts ?? []).map(post => this.normalizePost(post)),
            reels: (content.reels ?? []).map(reel => this.normalizeHashtagReel(reel)),
            communities: (content.communities ?? []).map(community => this.normalizeHashtagCommunity(community)),
            communityPosts: (content.communityPosts ?? []).map(post => this.normalizeHashtagCommunityPost(post)),
            blogs: (content.blogs ?? []).map(blog => this.normalizeHashtagBlog(blog)),
            blogPosts: (content.blogPosts ?? []).map(post => this.normalizeHashtagBlogPost(post))
        };
    }

    async loadPostsByAuthorHandleAsync(handle: string): Promise<PostDto[]> {
        const posts = await firstValueFrom(this.api.getPostsByAuthorHandle(handle));
        return posts.map(post => this.normalizePost(post));
    }

    async loadPublicPostsByAuthorHandleAsync(handle: string): Promise<PostDto[]> {
        const posts = await firstValueFrom(this.api.getPublicPostsByAuthorHandle(handle));
        return posts.map(post => this.normalizePost(post));
    }

    async loadPublicPostByIdAsync(postId: string): Promise<PostDto | null> {
        const normalized = postId.trim();
        if (!normalized) {
            return null;
        }

        try {
            const post = await firstValueFrom(this.api.getPublicPost(normalized));
            return this.normalizePost(post);
        } catch {
            return null;
        }
    }

    async searchPostsAsync(query: string): Promise<PostDto[]> {
        const posts = await firstValueFrom(this.api.searchPosts(query));
        return posts.map(post => this.normalizePost(post));
    }

    async searchHashtagsAsync(query: string): Promise<HashtagSearchResultDto[]> {
        return firstValueFrom(this.api.searchHashtags(query));
    }

    async loadTrendingHashtagsAsync(take = 10): Promise<HashtagSearchResultDto[]> {
        return firstValueFrom(this.api.getTrendingHashtags(take));
    }

    async loadFollowedHashtagsAsync(take = 20): Promise<FollowedHashtagDto[]> {
        return firstValueFrom(this.api.getFollowedHashtags(take));
    }

    async followHashtagAsync(tag: string): Promise<FollowedHashtagDto> {
        const followed = await firstValueFrom(this.api.followHashtag(tag));
        this.emitAppChange('posts');
        return followed;
    }

    async unfollowHashtagAsync(tag: string): Promise<void> {
        await firstValueFrom(this.api.unfollowHashtag(tag));
        this.emitAppChange('posts');
    }

    async searchProfilesAsync(query: string): Promise<ProfileDto[]> {
        const profiles = await firstValueFrom(this.api.searchProfiles(query));
        return profiles.map(profile => this.normalizeProfile(profile));
    }

    async createPostAsync(content: string, imageFiles?: File[], isSensitive = false): Promise<void> {
        await firstValueFrom(this.api.createPost(content, imageFiles, isSensitive));
        this.message = 'Post created.';
        this.emitAppChange('posts');
    }

    async createStoryAsync(mediaFile: File, caption?: string, isSensitive = false, thumbnailFile?: File): Promise<StoryDto> {
        const story = this.normalizeStory(await firstValueFrom(this.api.createStory(mediaFile, caption, isSensitive, thumbnailFile)));
        this.message = 'Story created.';
        this.emitAppChange('posts');
        return story;
    }

    async createReelAsync(videoFile: File, durationSeconds: number, caption?: string, thumbnailFile?: File, isSensitive = false): Promise<ReelDto> {
        const reel = this.normalizeReel(await firstValueFrom(this.api.createReel(videoFile, durationSeconds, caption, thumbnailFile, isSensitive)));
        this.message = 'Reel created.';
        this.emitAppChange('posts');
        return reel;
    }

    getHideSensitiveMediaPreference(): boolean {
        const raw = localStorage.getItem('socialsez-web-safety-prefs');
        if (!raw) {
            return false;
        }

        try {
            const parsed = JSON.parse(raw) as { hideSensitiveMedia?: boolean };
            return parsed.hideSensitiveMedia === true;
        } catch {
            return false;
        }
    }

    async updateReelAsync(reelId: string, caption?: string): Promise<ReelDto> {
        const reel = this.normalizeReel(await firstValueFrom(this.api.updateReel(reelId, caption)));
        this.message = 'Reel updated.';
        this.emitAppChange('posts');
        return reel;
    }

    async deleteReelAsync(reelId: string): Promise<void> {
        await firstValueFrom(this.api.deleteReel(reelId));
        this.message = 'Reel deleted.';
        this.emitAppChange('posts');
    }

    async updatePostAsync(postId: string, content: string): Promise<void> {
        await firstValueFrom(this.api.updatePost(postId, { content }));
        this.message = 'Post updated.';
        this.emitAppChange('posts');
    }

    async deletePostAsync(postId: string): Promise<void> {
        await firstValueFrom(this.api.deletePost(postId));
        this.message = 'Post deleted.';
        this.emitAppChange('posts');
    }

    async togglePostLikeAsync(postId: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.togglePostLike(postId));
        return this.normalizePost(updated);
    }

    async setPostReactionAsync(postId: string, reactionType: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.setPostReaction(postId, { type: reactionType }));
        return this.normalizePost(updated);
    }

    async clearPostReactionAsync(postId: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.clearPostReaction(postId));
        return this.normalizePost(updated);
    }

    async addCommentAsync(postId: string, content: string, parentCommentId?: string | null): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.addComment(postId, content, parentCommentId));
        return this.normalizePost(updated);
    }

    async toggleReelCommentLikeAsync(reelId: string, commentId: string): Promise<ReelDto> {
        const updated = await firstValueFrom(this.api.toggleReelCommentLike(reelId, commentId));
        return this.normalizeReel(updated);
    }

    async updateCommentAsync(postId: string, commentId: string, content: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.updateComment(postId, commentId, content));
        return this.normalizePost(updated);
    }

    async deleteCommentAsync(postId: string, commentId: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.deleteComment(postId, commentId));
        return this.normalizePost(updated);
    }

    async setCommentReactionAsync(postId: string, commentId: string, reactionType: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.setCommentReaction(postId, commentId, { type: reactionType }));
        return this.normalizePost(updated);
    }

    async clearCommentReactionAsync(postId: string, commentId: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.clearCommentReaction(postId, commentId));
        return this.normalizePost(updated);
    }

    async uploadImageAsync(file: File): Promise<string> {
        const response = await firstValueFrom(this.api.uploadImage(file));
        return this.normalizeMediaUrl(response.url) ?? response.url;
    }

    async loadPublicProfileAsync(handle: string): Promise<ProfileDto> {
        const profile = await firstValueFrom(this.api.getProfile(handle));
        return this.normalizeProfile(profile);
    }

    async loadProfileActivitySummaryAsync(handle: string): Promise<ProfileActivitySummaryDto> {
        return firstValueFrom(this.api.getProfileActivitySummary(handle));
    }

    async followAsync(followedId: string): Promise<FollowActionResultDto> {
        const result = await firstValueFrom(this.api.follow(followedId));
        this.message = result.status === 'RequestPending' ? 'Follow request sent.' : 'Now following user.';
        this.emitAppChange('posts');
        return result;
    }

    async unfollowAsync(followedId: string): Promise<void> {
        await firstValueFrom(this.api.unfollow(followedId));
        this.message = 'Unfollowed user.';
        this.emitAppChange('posts');
    }

    async getFollowStatusAsync(followedId: string): Promise<FollowStatusDto> {
        return firstValueFrom(this.api.isFollowing(followedId));
    }

    async getSafetyStatusAsync(targetProfileId: string): Promise<SafetyStatusDto> {
        return firstValueFrom(this.api.getSafetyStatus(targetProfileId));
    }

    async loadBlockedProfilesAsync(take = 100): Promise<ProfileDto[]> {
        const profiles = await firstValueFrom(this.api.getBlockedProfiles(take));
        return profiles.map(profile => this.normalizeProfile(profile));
    }

    async blockProfileAsync(targetProfileId: string): Promise<void> {
        await firstValueFrom(this.api.blockProfile(targetProfileId));
        this.message = 'Profile blocked.';
        this.emitAppChange('profile');
    }

    async unblockProfileAsync(targetProfileId: string): Promise<void> {
        await firstValueFrom(this.api.unblockProfile(targetProfileId));
        this.message = 'Profile unblocked.';
        this.emitAppChange('profile');
    }

    async muteProfileAsync(targetProfileId: string): Promise<void> {
        await firstValueFrom(this.api.muteProfile(targetProfileId));
        this.message = 'Profile muted.';
        this.emitAppChange('profile');
    }

    async unmuteProfileAsync(targetProfileId: string): Promise<void> {
        await firstValueFrom(this.api.unmuteProfile(targetProfileId));
        this.message = 'Profile unmuted.';
        this.emitAppChange('profile');
    }

    async reportProfileAsync(targetProfileId: string, reason: string, details?: string): Promise<void> {
        await firstValueFrom(this.api.reportProfile(targetProfileId, reason, details));
        this.message = 'Report submitted.';
        this.emitAppChange('profile');
    }

    async reportPostAsync(targetPostId: string, reason: string, details?: string): Promise<void> {
        await firstValueFrom(this.api.reportPost(targetPostId, reason, details));
        this.message = 'Report submitted.';
        this.emitAppChange('profile');
    }

    async reportReelAsync(targetReelId: string, reason: string, details?: string): Promise<void> {
        await firstValueFrom(this.api.reportReel(targetReelId, reason, details));
        this.message = 'Report submitted.';
        this.emitAppChange('profile');
    }

    async reportStoryAsync(targetStoryId: string, reason: string, details?: string): Promise<void> {
        await firstValueFrom(this.api.reportStory(targetStoryId, reason, details));
        this.message = 'Report submitted.';
        this.emitAppChange('profile');
    }

    async reportCommentAsync(targetCommentId: string, reason: string, details?: string): Promise<void> {
        await firstValueFrom(this.api.reportComment(targetCommentId, reason, details));
        this.message = 'Report submitted.';
        this.emitAppChange('profile');
    }

    async reportReelCommentAsync(targetReelCommentId: string, reason: string, details?: string): Promise<void> {
        await firstValueFrom(this.api.reportReelComment(targetReelCommentId, reason, details));
        this.message = 'Report submitted.';
        this.emitAppChange('profile');
    }

    async reportMessageAsync(targetMessageId: string, reason: string, details?: string): Promise<void> {
        await firstValueFrom(this.api.reportMessage(targetMessageId, reason, details));
        this.message = 'Report submitted.';
        this.emitAppChange('profile');
    }

    async isFollowingAsync(followedId: string): Promise<boolean> {
        const response = await this.getFollowStatusAsync(followedId);
        return response.isFollowing;
    }

    async loadFollowingAsync(take = 100): Promise<ProfileDto[]> {
        const profiles = await firstValueFrom(this.api.getFollowing(take));
        return profiles.map(profile => this.normalizeProfile(profile));
    }

    async loadFollowSuggestionsAsync(takePerGroup = 10): Promise<FollowSuggestionsDto> {
        const suggestions = await firstValueFrom(this.api.getFollowSuggestions(takePerGroup));
        return {
            following: suggestions.following.map(profile => this.normalizeProfile(profile)),
            relevant: suggestions.relevant.map(profile => this.normalizeProfile(profile))
        };
    }

    async loadIncomingFollowRequestsAsync(take = 50): Promise<FollowRequestDto[]> {
        return firstValueFrom(this.api.getIncomingFollowRequests(take));
    }

    async approveFollowRequestAsync(followerId: string): Promise<void> {
        await firstValueFrom(this.api.approveFollowRequest(followerId));
        this.emitAppChange('notifications');
    }

    async declineFollowRequestAsync(followerId: string): Promise<void> {
        await firstValueFrom(this.api.declineFollowRequest(followerId));
        this.emitAppChange('notifications');
    }

    async createCommunityAsync(name: string, description: string | null, rules: CommunityRuleDto[] | null, imageUrl: string | null, isPrivate: boolean): Promise<CommunityDto> {
        const created = await firstValueFrom(this.api.createCommunity(name, description, rules, imageUrl, isPrivate));
        const normalized = this.normalizeCommunity(created);
        this.message = 'Community created.';
        this.emitAppChange('profile');
        return normalized;
    }

    async updateCommunityAsync(communityId: string, name: string, description: string | null, rules: CommunityRuleDto[] | null, imageUrl: string | null, isPrivate: boolean): Promise<CommunityDto> {
        const updated = await firstValueFrom(this.api.updateCommunity(communityId, name, description, rules, imageUrl, isPrivate));
        const normalized = this.normalizeCommunity(updated);
        this.message = 'Community updated.';
        this.emitAppChange('profile');
        return normalized;
    }

    async getCommunityByIdAsync(communityId: string, members = 20): Promise<CommunityDto | null> {
        try {
            const community = await firstValueFrom(this.api.getCommunityById(communityId, members));
            return this.normalizeCommunity(community);
        } catch {
            return null;
        }
    }

    async getCommunityBySlugAsync(slug: string, members = 20): Promise<CommunityDto | null> {
        try {
            const normalizedSlug = this.normalizeCommunitySlugInput(slug);
            if (!normalizedSlug) {
                return null;
            }

            const community = await firstValueFrom(this.api.getCommunityBySlug(normalizedSlug, members));
            return this.normalizeCommunity(community);
        } catch {
            return null;
        }
    }

    async loadMyCommunitiesAsync(take = 50): Promise<CommunityDto[]> {
        const communities = await firstValueFrom(this.api.getMyCommunities(take));
        return communities.map(community => this.normalizeCommunity(community));
    }

    async discoverCommunitiesAsync(query?: string, take = 50): Promise<CommunityDto[]> {
        const communities = await firstValueFrom(this.api.discoverCommunities(query, take));
        return communities.map(community => this.normalizeCommunity(community));
    }

    async joinCommunityAsync(communityId: string): Promise<CommunityDto> {
        const joined = await firstValueFrom(this.api.joinCommunity(communityId));
        const normalized = this.normalizeCommunity(joined);
        this.message = 'Joined community.';
        this.emitAppChange('profile');
        return normalized;
    }

    async leaveCommunityAsync(communityId: string): Promise<void> {
        await firstValueFrom(this.api.leaveCommunity(communityId));
        this.message = 'Left community.';
        this.emitAppChange('profile');
    }

    async updateCommunityMemberRoleAsync(communityId: string, memberProfileId: string, role: 'Member' | 'Moderator'): Promise<CommunityDto> {
        const updated = await firstValueFrom(this.api.updateCommunityMemberRole(communityId, memberProfileId, role));
        const normalized = this.normalizeCommunity(updated);
        this.message = role === 'Moderator' ? 'Member promoted to moderator.' : 'Moderator role removed.';
        this.emitAppChange('profile');
        return normalized;
    }

    async timeoutCommunityMemberAsync(communityId: string, memberProfileId: string, durationDays: 1 | 7 | 30): Promise<CommunityDto> {
        const updated = await firstValueFrom(this.api.timeoutCommunityMember(communityId, memberProfileId, durationDays));
        const normalized = this.normalizeCommunity(updated);
        this.message = `Member timed out for ${durationDays} day${durationDays === 1 ? '' : 's'}.`;
        this.emitAppChange('profile');
        return normalized;
    }

    async createBlogAsync(title: string, description: string | null, slug: string | null, isPublic: boolean, allowLikes: boolean, allowComments: boolean, allowShares: boolean, allowEmbeds: boolean, theme: BlogThemeConfigDto | null): Promise<BlogDto> {
        const created = await firstValueFrom(this.api.createBlog(title, description, slug, isPublic, allowLikes, allowComments, allowShares, allowEmbeds, theme));
        return this.normalizeBlog(created);
    }

    async updateBlogAsync(blogId: string, title: string, description: string | null, slug: string | null, isPublic: boolean, allowLikes: boolean, allowComments: boolean, allowShares: boolean, allowEmbeds: boolean, theme: BlogThemeConfigDto | null): Promise<BlogDto> {
        const updated = await firstValueFrom(this.api.updateBlog(blogId, title, description, slug, isPublic, allowLikes, allowComments, allowShares, allowEmbeds, theme));
        return this.normalizeBlog(updated);
    }

    async deleteBlogAsync(blogId: string): Promise<void> {
        await firstValueFrom(this.api.deleteBlog(blogId));
    }

    async loadMyBlogsAsync(): Promise<BlogDto[]> {
        const blogs = await firstValueFrom(this.api.getMyBlogs());
        return blogs.map(blog => this.normalizeBlog(blog));
    }

    async discoverBlogsAsync(query?: string, take = 60): Promise<BlogDto[]> {
        const blogs = await firstValueFrom(this.api.discoverBlogs(query, take));
        return blogs.map(blog => this.normalizeBlog(blog));
    }

    async loadFollowingBlogsAsync(query?: string, take = 60): Promise<BlogDto[]> {
        const blogs = await firstValueFrom(this.api.getFollowingBlogs(query, take));
        return blogs.map(blog => this.normalizeBlog(blog));
    }

    async loadBlogsByAuthorHandleAsync(handle: string): Promise<BlogDto[]> {
        const blogs = await firstValueFrom(this.api.getBlogsByAuthorHandle(handle));
        return blogs.map(blog => this.normalizeBlog(blog));
    }

    async loadBlogByAuthorAndSlugAsync(handle: string, blogSlug: string): Promise<BlogDto | null> {
        try {
            const blog = await firstValueFrom(this.api.getBlogByAuthorAndSlug(handle, blogSlug));
            return this.normalizeBlog(blog);
        } catch {
            return null;
        }
    }

    async createBlogPostAsync(blogId: string, title: string, content: string, excerpt: string | null, coverImageUrl: string | null, tags: string[] | null, isPublished: boolean, slug: string | null): Promise<BlogPostDto> {
        const created = await firstValueFrom(this.api.createBlogPost(blogId, title, content, excerpt, coverImageUrl, tags, isPublished, slug));
        return this.normalizeBlogPost(created);
    }

    async updateBlogPostAsync(blogId: string, postId: string, title: string, content: string, excerpt: string | null, coverImageUrl: string | null, tags: string[] | null, isPublished: boolean, slug: string | null): Promise<BlogPostDto> {
        const updated = await firstValueFrom(this.api.updateBlogPost(blogId, postId, title, content, excerpt, coverImageUrl, tags, isPublished, slug));
        return this.normalizeBlogPost(updated);
    }

    async deleteBlogPostAsync(blogId: string, postId: string): Promise<void> {
        await firstValueFrom(this.api.deleteBlogPost(blogId, postId));
    }

    async saveBlogPostAsync(blogId: string, postId: string): Promise<BlogPostDto> {
        const saved = await firstValueFrom(this.api.saveBlogPost(blogId, postId));
        this.message = 'Post saved.';
        return this.normalizeBlogPost(saved);
    }

    async unsaveBlogPostAsync(blogId: string, postId: string): Promise<void> {
        await firstValueFrom(this.api.unsaveBlogPost(blogId, postId));
        this.message = 'Post removed from saved.';
    }

    async loadBlogPostsAsync(handle: string, blogSlug: string): Promise<BlogPostDto[]> {
        const posts = await firstValueFrom(this.api.getBlogPosts(handle, blogSlug));
        return posts.map(post => this.normalizeBlogPost(post));
    }

    async loadBlogPostAsync(handle: string, blogSlug: string, postSlug: string): Promise<BlogPostDto | null> {
        try {
            const post = await firstValueFrom(this.api.getBlogPost(handle, blogSlug, postSlug));
            return this.normalizeBlogPost(post);
        } catch {
            return null;
        }
    }

    async loadSavedBlogPostsAsync(take = 50, skip = 0): Promise<BlogPostDto[]> {
        try {
            const posts = await firstValueFrom(this.api.getSavedBlogPosts(take, skip));
            return posts.map(post => this.normalizeBlogPost(post));
        } catch {
            const discoveredBlogs = await this.discoverBlogsAsync(undefined, 80);
            const blogCandidates = discoveredBlogs.slice(0, 40);

            const postGroups = await Promise.all(blogCandidates.map(async blog => {
                try {
                    const posts = await this.loadBlogPostsAsync(blog.ownerHandle, blog.slug);
                    return posts.filter(post => post.isSavedByMe);
                } catch {
                    return [] as BlogPostDto[];
                }
            }));

            return postGroups
                .flat()
                .sort((left, right) => {
                    const leftTicks = new Date(left.publishedAtUtc ?? left.updatedAtUtc).getTime();
                    const rightTicks = new Date(right.publishedAtUtc ?? right.updatedAtUtc).getTime();
                    return rightTicks - leftTicks;
                })
                .slice(skip, skip + take);
        }
    }

    async createCommunityPostAsync(
        communityId: string,
        title: string | null,
        linkUrl: string | null,
        content: string | null,
        mediaContent: string | null,
        imageUrls: string[] | null,
        pollQuestion: string | null,
        pollOptions: string[] | null
    ): Promise<CommunityPostDto> {
        const created = await firstValueFrom(this.api.createCommunityPost(communityId, title, linkUrl, content, mediaContent, imageUrls, pollQuestion, pollOptions));
        this.message = 'Posted to community.';
        this.emitAppChange('posts');
        return this.normalizeCommunityPost(created);
    }

    async addCommunityPostCommentAsync(communityId: string, postId: string, content: string, parentCommentId?: string | null): Promise<CommunityPostDto> {
        const updated = await firstValueFrom(this.api.addCommunityPostComment(communityId, postId, content, parentCommentId ?? null));
        this.message = 'Comment posted.';
        this.emitAppChange('posts');
        return this.normalizeCommunityPost(updated);
    }

    async updateCommunityPostCommentAsync(communityId: string, postId: string, commentId: string, content: string): Promise<CommunityPostDto> {
        const updated = await firstValueFrom(this.api.updateCommunityPostComment(communityId, postId, commentId, content));
        this.message = 'Comment updated.';
        this.emitAppChange('posts');
        return this.normalizeCommunityPost(updated);
    }

    async deleteCommunityPostCommentAsync(communityId: string, postId: string, commentId: string): Promise<CommunityPostDto> {
        const updated = await firstValueFrom(this.api.deleteCommunityPostComment(communityId, postId, commentId));
        this.message = 'Comment deleted.';
        this.emitAppChange('posts');
        return this.normalizeCommunityPost(updated);
    }

    async voteCommunityPostAsync(communityId: string, postId: string, voteType?: 'Upvote' | 'Downvote'): Promise<CommunityPostDto> {
        const updated = await firstValueFrom(this.api.voteCommunityPost(communityId, postId, voteType));
        return this.normalizeCommunityPost(updated);
    }

    async deleteCommunityPostAsync(communityId: string, postId: string): Promise<void> {
        await firstValueFrom(this.api.deleteCommunityPost(communityId, postId));
        this.message = 'Post deleted.';
        this.emitAppChange('posts');
    }

    async updateCommunityPostAsync(
        communityId: string,
        postId: string,
        title: string | null,
        linkUrl: string | null,
        content: string | null,
        mediaContent: string | null,
        imageUrls: string[] | null = null,
        pollQuestion: string | null = null,
        pollOptions: string[] | null = null,
        clearPoll = false
    ): Promise<CommunityPostDto> {
        const updated = await firstValueFrom(this.api.updateCommunityPost(communityId, postId, title, linkUrl, content, mediaContent, imageUrls, pollQuestion, pollOptions, clearPoll));
        this.message = 'Post updated.';
        this.emitAppChange('posts');
        return this.normalizeCommunityPost(updated);
    }

    async loadCommunityPostsAsync(communityId: string, query?: string, take = 50): Promise<CommunityPostDto[]> {
        const posts = await firstValueFrom(this.api.getCommunityPosts(communityId, query, take));
        return posts.map(post => this.normalizeCommunityPost(post));
    }

    async loadSavedCommunityPostsAsync(take = 50, skip = 0): Promise<CommunityPostDto[]> {
        try {
            const posts = await firstValueFrom(this.api.getSavedCommunityPosts(take, skip));
            return posts.map(post => this.normalizeCommunityPost(post));
        } catch {
            const candidates = await this.searchCommunityPostsAsync('', 200);
            return candidates
                .filter(post => post.isSavedByMe)
                .slice(skip, skip + take);
        }
    }

    async searchCommunityPostsAsync(query: string, take = 50): Promise<CommunityPostDto[]> {
        const posts = await firstValueFrom(this.api.searchCommunityPosts(query, take));
        return posts.map(post => this.normalizeCommunityPost(post));
    }

    async saveCommunityPostAsync(communityId: string, postId: string): Promise<CommunityPostDto> {
        const saved = await firstValueFrom(this.api.saveCommunityPost(communityId, postId));
        this.message = 'Post saved.';
        return this.normalizeCommunityPost(saved);
    }

    async unsaveCommunityPostAsync(communityId: string, postId: string): Promise<void> {
        await firstValueFrom(this.api.unsaveCommunityPost(communityId, postId));
        this.message = 'Post removed from saved.';
    }

    async voteCommunityPollAsync(communityId: string, pollId: string, optionId: string): Promise<CommunityPollDto> {
        const poll = await firstValueFrom(this.api.voteCommunityPoll(communityId, pollId, optionId));
        return this.normalizeCommunityPoll(poll);
    }

    // --- Saved Collections ---

    async loadAllSavedItemsAsync(take = 50, skip = 0): Promise<SavedItemDto[]> {
        return firstValueFrom(this.api.getAllSavedItems(take, skip));
    }

    async loadCollectionsAsync(): Promise<SavedCollectionDto[]> {
        return firstValueFrom(this.api.getCollections());
    }

    async saveToCollectionAsync(request: SaveToCollectionRequest, collectionId: string | null): Promise<SavedItemDto> {
        let item: SavedItemDto;

        switch (request.kind) {
            case 'post':
                item = await this.savePostAsync(request.itemId);
                break;
            case 'reel':
                item = await this.saveReelAsync(request.itemId);
                break;
            case 'community-post':
                item = await firstValueFrom(this.api.saveCommunityPostToCollections(request.itemId));
                break;
            case 'blog-post':
                item = await firstValueFrom(this.api.saveBlogPostToCollections(request.itemId));
                break;
            default:
                throw new Error('Unsupported save target.');
        }

        if (collectionId) {
            await this.addToCollectionAsync(collectionId, item.id);
        }

        this.message = collectionId ? 'Saved to collection.' : 'Saved to All Saved.';
        return item;
    }

    async createCollectionAsync(name: string): Promise<SavedCollectionDto> {
        const collection = await firstValueFrom(this.api.createCollection(name));
        this.message = `Collection "${collection.name}" created.`;
        return collection;
    }

    async deleteCollectionAsync(collectionId: string): Promise<void> {
        await firstValueFrom(this.api.deleteCollection(collectionId));
        this.message = 'Collection deleted.';
    }

    async renameCollectionAsync(collectionId: string, name: string): Promise<SavedCollectionDto> {
        const collection = await firstValueFrom(this.api.renameCollection(collectionId, name));
        this.message = `Collection renamed to "${collection.name}".`;
        return collection;
    }

    async loadCollectionItemsAsync(collectionId: string, take = 50, skip = 0): Promise<SavedItemDto[]> {
        return firstValueFrom(this.api.getCollectionItems(collectionId, take, skip));
    }

    async savePostAsync(postId: string): Promise<SavedItemDto> {
        const item = await firstValueFrom(this.api.savePost(postId));
        this.savedPostIds.set(postId, item.id);
        return item;
    }

    async saveReelAsync(reelId: string): Promise<SavedItemDto> {
        const item = await firstValueFrom(this.api.saveReel(reelId));
        this.savedReelIds.set(reelId, item.id);
        return item;
    }

    async unsaveItemAsync(savedItemId: string): Promise<void> {
        await firstValueFrom(this.api.unsaveItem(savedItemId));
        // Remove from local maps
        for (const [k, v] of this.savedPostIds) { if (v === savedItemId) { this.savedPostIds.delete(k); break; } }
        for (const [k, v] of this.savedReelIds) { if (v === savedItemId) { this.savedReelIds.delete(k); break; } }
    }

    async addToCollectionAsync(collectionId: string, savedItemId: string): Promise<void> {
        await firstValueFrom(this.api.addToCollection(collectionId, savedItemId));
    }

    async removeFromCollectionAsync(collectionId: string, savedItemId: string): Promise<void> {
        await firstValueFrom(this.api.removeFromCollection(collectionId, savedItemId));
    }

    async loadSavedStatusAsync(postIds: string[], reelIds: string[]): Promise<SavedStatusDto> {
        const status = await firstValueFrom(this.api.getSavedStatus(postIds, reelIds));
        for (const [postId, savedItemId] of Object.entries(status.savedPostIds)) {
            this.savedPostIds.set(postId, savedItemId);
        }
        for (const [reelId, savedItemId] of Object.entries(status.savedReelIds)) {
            this.savedReelIds.set(reelId, savedItemId);
        }
        return status;
    }

    isPostSaved(postId: string): boolean {
        return this.savedPostIds.has(postId);
    }

    isReelSaved(reelId: string): boolean {
        return this.savedReelIds.has(reelId);
    }

    getSavedItemIdForPost(postId: string): string | undefined {
        return this.savedPostIds.get(postId);
    }

    getSavedItemIdForReel(reelId: string): string | undefined {
        return this.savedReelIds.get(reelId);
    }

    // --- End Saved Collections ---

    async loadNotificationsAsync(take = 50): Promise<NotificationDto[]> {
        return firstValueFrom(this.api.getNotifications(take));
    }

    async markNotificationReadAsync(notificationId: string): Promise<void> {
        await firstValueFrom(this.api.markNotificationRead(notificationId));
        this.emitAppChange('notifications');
    }

    async markAllNotificationsReadAsync(): Promise<number> {
        const response = await firstValueFrom(this.api.markAllNotificationsRead());
        this.emitAppChange('notifications');
        return response.updatedCount;
    }

    async updateProfileAsync(request: UpdateProfileRequest): Promise<void> {
        const updated = await firstValueFrom(this.api.updateMyProfile(request));
        this.profile = this.normalizeProfile(updated);
        this.message = 'Profile updated.';
        this.emitAppChange('profile');
    }

    async updateProfilePrivacyAsync(isPrivate: boolean): Promise<void> {
        const updated = await firstValueFrom(this.api.updateMyPrivacy({ isPrivate }));
        this.profile = this.normalizeProfile(updated);
        this.message = 'Profile privacy updated.';
        this.emitAppChange('profile');
    }

    async loadChatConversationsAsync(): Promise<ChatConversationDto[]> {
        return firstValueFrom(this.api.getChatConversations());
    }

    async createDirectConversationAsync(otherProfileId: string): Promise<ChatConversationDto> {
        return firstValueFrom(this.api.createOrGetDirectConversation({ otherProfileId }));
    }

    async createGroupConversationAsync(title: string, memberProfileIds: string[]): Promise<ChatConversationDto> {
        return firstValueFrom(this.api.createGroupConversation({ title, memberProfileIds }));
    }

    async renameGroupConversationAsync(conversationId: string, title: string): Promise<ChatConversationDto> {
        return firstValueFrom(this.api.updateGroupConversationTitle(conversationId, { title }));
    }

    async leaveGroupConversationAsync(conversationId: string): Promise<void> {
        await firstValueFrom(this.api.leaveGroupConversation(conversationId));
    }

    async setConversationMuteAsync(conversationId: string, isMuted: boolean): Promise<ChatConversationDto> {
        return firstValueFrom(this.api.setConversationMute(conversationId, { isMuted }));
    }

    async loadChatMessagesAsync(conversationId: string, take = 50, skip = 0): Promise<ChatMessageDto[]> {
        return firstValueFrom(this.api.getChatMessages(conversationId, take, skip));
    }

    async sendChatMessageAsync(conversationId: string, content: string): Promise<ChatMessageDto> {
        return firstValueFrom(this.api.sendChatMessage(conversationId, { content }));
    }

    async updateChatMessageAsync(messageId: string, content: string): Promise<ChatMessageDto> {
        return firstValueFrom(this.api.updateChatMessage(messageId, { content }));
    }

    async setMessageReactionAsync(messageId: string, reactionType: string): Promise<ChatMessageDto> {
        return firstValueFrom(this.api.setMessageReaction(messageId, { type: reactionType }));
    }

    async clearMessageReactionAsync(messageId: string): Promise<ChatMessageDto> {
        return firstValueFrom(this.api.clearMessageReaction(messageId));
    }

    async refreshMeAsync(): Promise<void> {
        const me = await firstValueFrom(this.api.getMe());
        this.profile = this.normalizeProfile(me);
        this.emitAppChange('profile');
    }

    private applyAuth(auth: AuthResponse): void {
        this.profile = this.normalizeProfile(auth.profile);
        this.scheduleSilentRefresh(auth.expiresAtUtc);
    }

    private normalizeProfile(profile: ProfileDto): ProfileDto {
        const normalizedImageUrl = this.normalizeMediaUrl(profile.imageUrl);
        return {
            ...profile,
            imageUrl: normalizedImageUrl
        };
    }

    private normalizePost(post: PostDto): PostDto {
        const normalizedImageUrls = (post.imageUrls ?? [])
            .map(url => this.normalizeMediaUrl(url))
            .filter((url): url is string => !!url);

        const normalizedPrimaryImage = this.normalizeMediaUrl(post.imageUrl) ?? normalizedImageUrls[0];

        return {
            ...post,
            isSensitive: post.isSensitive === true,
            authorImageUrl: this.normalizeMediaUrl(post.authorImageUrl),
            imageUrl: normalizedPrimaryImage,
            imageUrls: normalizedImageUrls.length > 0
                ? normalizedImageUrls
                : (normalizedPrimaryImage ? [normalizedPrimaryImage] : []),
            comments: (post.comments ?? []).map(comment => ({
                ...comment,
                authorImageUrl: this.normalizeMediaUrl(comment.authorImageUrl)
            }))
        };
    }

    private normalizeStory(story: StoryDto): StoryDto {
        return {
            ...story,
            isSensitive: story.isSensitive === true,
            authorImageUrl: this.normalizeMediaUrl(story.authorImageUrl),
            mediaUrl: this.normalizeMediaUrl(story.mediaUrl) ?? story.mediaUrl,
            thumbnailUrl: this.normalizeMediaUrl(story.thumbnailUrl)
        };
    }

    private normalizeStoryGroup(storyGroup: StoryGroupDto): StoryGroupDto {
        return {
            ...storyGroup,
            authorImageUrl: this.normalizeMediaUrl(storyGroup.authorImageUrl),
            stories: (storyGroup.stories ?? []).map(story => this.normalizeStory(story))
        };
    }

    private normalizeReel(reel: ReelDto): ReelDto {
        return {
            ...reel,
            isSensitive: reel.isSensitive === true,
            authorImageUrl: this.normalizeMediaUrl(reel.authorImageUrl),
            videoUrl: this.normalizeMediaUrl(reel.videoUrl) ?? reel.videoUrl,
            thumbnailUrl: this.normalizeMediaUrl(reel.thumbnailUrl),
            comments: (reel.comments ?? []).map(comment => ({
                ...comment,
                authorImageUrl: this.normalizeMediaUrl(comment.authorImageUrl)
            }))
        };
    }

    private normalizeCommunity(community: CommunityDto): CommunityDto {
        return {
            ...community,
            rules: (community.rules ?? [])
                .map(rule => {
                    const candidate = rule as unknown as CommunityRuleDto | string;
                    if (typeof candidate === 'string') {
                        return { text: candidate.trim() } as CommunityRuleDto;
                    }

                    const text = (candidate.text ?? '').trim();
                    const description = candidate.description?.trim() || undefined;
                    return { text, description } as CommunityRuleDto;
                })
                .filter(rule => !!rule.text),
            imageUrl: this.normalizeMediaUrl(community.imageUrl),
            members: (community.members ?? []).map(member => ({
                ...member,
                imageUrl: this.normalizeMediaUrl(member.imageUrl)
            }))
        };
    }

    private normalizeCommunityPost(post: CommunityPostDto): CommunityPostDto {
        return {
            ...post,
            authorImageUrl: this.normalizeMediaUrl(post.authorImageUrl),
            imageUrl: this.normalizeMediaUrl(post.imageUrl),
            imageUrls: (post.imageUrls ?? [])
                .map(url => this.normalizeMediaUrl(url))
                .filter((url): url is string => !!url),
            poll: post.poll ? this.normalizeCommunityPoll(post.poll) : undefined,
            comments: (post.comments ?? []).map(comment => ({
                ...comment,
                authorImageUrl: this.normalizeMediaUrl(comment.authorImageUrl)
            }))
        };
    }

    private normalizeBlog(blog: BlogDto): BlogDto {
        return {
            ...blog,
            ownerHandle: (blog.ownerHandle ?? '').trim().toLowerCase(),
            allowLikes: blog.allowLikes !== false,
            allowComments: blog.allowComments !== false,
            allowShares: blog.allowShares !== false,
            allowEmbeds: blog.allowEmbeds !== false,
            theme: {
                ...blog.theme,
                customCss: blog.theme?.customCss ?? undefined
            }
        };
    }

    private normalizeBlogPost(post: BlogPostDto): BlogPostDto {
        return {
            ...post,
            authorHandle: (post.authorHandle ?? '').trim().toLowerCase(),
            coverImageUrl: this.normalizeMediaUrl(post.coverImageUrl),
            isSavedByMe: post.isSavedByMe === true
        };
    }

    private normalizeCommunityPoll(poll: CommunityPollDto): CommunityPollDto {
        return {
            ...poll,
            options: (poll.options ?? []).map(option => ({ ...option }))
        };
    }

    private normalizeHashtagReel(reel: HashtagReelDto): HashtagReelDto {
        return {
            ...reel,
            authorImageUrl: this.normalizeMediaUrl(reel.authorImageUrl),
            thumbnailUrl: this.normalizeMediaUrl(reel.thumbnailUrl)
        };
    }

    private normalizeHashtagCommunity(community: HashtagCommunityDto): HashtagCommunityDto {
        return {
            ...community,
            imageUrl: this.normalizeMediaUrl(community.imageUrl)
        };
    }

    private normalizeHashtagCommunityPost(post: HashtagCommunityPostDto): HashtagCommunityPostDto {
        return {
            ...post,
            authorImageUrl: this.normalizeMediaUrl(post.authorImageUrl)
        };
    }

    private normalizeHashtagBlog(blog: HashtagBlogDto): HashtagBlogDto {
        return {
            ...blog,
            ownerHandle: (blog.ownerHandle ?? '').trim().toLowerCase()
        };
    }

    private normalizeHashtagBlogPost(post: HashtagBlogPostDto): HashtagBlogPostDto {
        return {
            ...post,
            authorHandle: (post.authorHandle ?? '').trim().toLowerCase(),
            coverImageUrl: this.normalizeMediaUrl(post.coverImageUrl)
        };
    }

    private emitAppChange(change: 'profile' | 'posts' | 'session' | 'notifications'): void {
        this.ngZone.run(() => this.appChanges.next(change));
    }

    private normalizeCommunitySlugInput(value: string | null | undefined): string {
        const normalizedWhitespace = (value ?? '').trim().replace(/_/g, '-');
        if (!normalizedWhitespace) {
            return '';
        }

        return normalizedWhitespace
            .split(/\s+/g)
            .filter(part => part.length > 0)
            .join('-')
            .toLowerCase();
    }

    private addNoticeHistoryEntry(message: string, version: number): void {
        const normalized = message.trim();
        if (!normalized) {
            return;
        }

        const entry: SessionNoticeEntry = {
            id: version,
            message: normalized,
            isError: this.errorMessagePattern.test(normalized),
            createdAtUtc: new Date().toISOString()
        };

        this._noticeHistory = [entry, ...this._noticeHistory].slice(0, this.maxNoticeHistory);
    }

    private resolveApiOrigin(): string {
        try {
            return new URL(environment.apiBaseUrl).origin;
        } catch {
            return '';
        }
    }

    private normalizeMediaUrl(value?: string | null): string | undefined {
        const trimmed = value?.trim();
        if (!trimmed) {
            return undefined;
        }

        // Some APIs may return Windows-style paths (e.g. uploads\avatars\x.jpg).
        // Normalize to URL-style separators before resolution.
        let normalizedInput = trimmed.replace(/\\+/g, '/');

        // Recover URL paths from absolute filesystem values like:
        // C:/repo/SocialSez.API/wwwroot/uploads/images/file.jpg
        // /var/app/wwwroot/uploads/images/file.jpg
        const lowerInput = normalizedInput.toLowerCase();
        const wwwrootUploadsIndex = lowerInput.indexOf('/wwwroot/uploads/');
        if (wwwrootUploadsIndex >= 0) {
            normalizedInput = normalizedInput.slice(wwwrootUploadsIndex + '/wwwroot'.length);
        } else {
            const uploadsIndex = lowerInput.indexOf('/uploads/');
            if (uploadsIndex > 0) {
                normalizedInput = normalizedInput.slice(uploadsIndex);
            }
        }

        if (normalizedInput.toLowerCase().startsWith('wwwroot/uploads/')) {
            normalizedInput = normalizedInput.slice('wwwroot'.length);
        }

        if (normalizedInput.toLowerCase().startsWith('uploads/')) {
            normalizedInput = `/${normalizedInput}`;
        }

        if (/^\/uploads\/images\/[0-9a-f-]{36}$/i.test(normalizedInput)) {
            normalizedInput = `/api${normalizedInput}`;
        }

        if (normalizedInput.startsWith('data:')) {
            return normalizedInput;
        }

        if (normalizedInput.startsWith('/')) {
            return this.apiOrigin ? `${this.apiOrigin}${normalizedInput}` : normalizedInput;
        }

        if (!/^https?:\/\//i.test(normalizedInput)) {
            if (this.apiOrigin) {
                const normalizedRelative = normalizedInput.replace(/^\/+/, '');
                return `${this.apiOrigin}/${normalizedRelative}`;
            }

            return normalizedInput;
        }

        try {
            const parsed = new URL(normalizedInput);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return undefined;
            }

            const isLocalHost = parsed.hostname === 'localhost'
                || parsed.hostname === '127.0.0.1'
                || parsed.hostname === '0.0.0.0';

            if (this.apiOrigin && isLocalHost) {
                return `${this.apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }

            return parsed.toString();
        } catch {
            return normalizedInput;
        }
    }

    private clearSession(): void {
        this.api.clearToken();
        this.stopSilentRefresh();
        this.profile = null;
    }

    private scheduleSilentRefresh(expiresAtUtc: string): void {
        this.stopSilentRefresh();

        const expiresAtMs = Date.parse(expiresAtUtc);
        const fallbackDelayMs = 4 * 60 * 1000;
        const minDelayMs = 15 * 1000;
        const refreshBeforeExpiryMs = 60 * 1000;

        const delayMs = Number.isNaN(expiresAtMs)
            ? fallbackDelayMs
            : Math.max(expiresAtMs - Date.now() - refreshBeforeExpiryMs, minDelayMs);

        this.silentRefreshTimerId = window.setTimeout(async () => {
            try {
                await this.refreshSessionAsync(true);
            } catch {
                this.clearSession();
                this.message = 'Session expired. Please login again.';
                await this.router.navigateByUrl('/auth');
            }
        }, delayMs);

        this.nextSilentRefreshAt = new Date(Date.now() + delayMs);
    }

    private stopSilentRefresh(): void {
        if (this.silentRefreshTimerId !== undefined) {
            window.clearTimeout(this.silentRefreshTimerId);
            this.silentRefreshTimerId = undefined;
        }

        this.nextSilentRefreshAt = null;
    }
}
