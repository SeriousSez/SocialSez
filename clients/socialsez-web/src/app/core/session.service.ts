import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
    AuthResponse,
    ChatConversationDto,
    ChatMessageDto,
    FeedMode,
    FollowActionResultDto,
    FollowRequestDto,
    FollowStatusDto,
    FollowSuggestionsDto,
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
    StoryGroupDto,
    UpdateProfileRequest
} from './api.types';
import { SocialSezApiService } from './socialsez-api.service';

export interface SessionNoticeEntry {
    id: number;
    message: string;
    isError: boolean;
    createdAtUtc: string;
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

    private silentRefreshTimerId: number | undefined;
    private bootstrapPromise: Promise<void> | null = null;
    private bootstrapped = false;

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

    async registerAsync(request: RegisterRequest): Promise<void> {
        const auth = await firstValueFrom(this.api.register(request));
        this.applyAuth(auth);
        this.message = `Registered as ${auth.profile.handle}.`;
        this.emitAppChange('session');
        await this.router.navigateByUrl('/feed');
    }

    async loginAsync(request: LoginRequest): Promise<void> {
        const auth = await firstValueFrom(this.api.login(request));
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
            return this.normalizeStoryGroup(storyGroup);
        } catch {
            return null;
        }
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

    async loadPostsByAuthorHandleAsync(handle: string): Promise<PostDto[]> {
        const posts = await firstValueFrom(this.api.getPostsByAuthorHandle(handle));
        return posts.map(post => this.normalizePost(post));
    }

    async loadPublicPostsByAuthorHandleAsync(handle: string): Promise<PostDto[]> {
        const posts = await firstValueFrom(this.api.getPublicPostsByAuthorHandle(handle));
        return posts.map(post => this.normalizePost(post));
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

    async searchProfilesAsync(query: string): Promise<ProfileDto[]> {
        const profiles = await firstValueFrom(this.api.searchProfiles(query));
        return profiles.map(profile => this.normalizeProfile(profile));
    }

    async createPostAsync(content: string, imageFile?: File): Promise<void> {
        await firstValueFrom(this.api.createPost(content, imageFile));
        this.message = 'Post created.';
        this.emitAppChange('posts');
    }

    async createStoryAsync(mediaFile: File, caption?: string): Promise<StoryDto> {
        const story = this.normalizeStory(await firstValueFrom(this.api.createStory(mediaFile, caption)));
        this.message = 'Story created.';
        this.emitAppChange('posts');
        return story;
    }

    async createReelAsync(videoFile: File, durationSeconds: number, caption?: string, thumbnailFile?: File): Promise<ReelDto> {
        const reel = this.normalizeReel(await firstValueFrom(this.api.createReel(videoFile, durationSeconds, caption, thumbnailFile)));
        this.message = 'Reel created.';
        this.emitAppChange('posts');
        return reel;
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
        return {
            ...post,
            authorImageUrl: this.normalizeMediaUrl(post.authorImageUrl),
            imageUrl: this.normalizeMediaUrl(post.imageUrl),
            comments: (post.comments ?? []).map(comment => ({
                ...comment,
                authorImageUrl: this.normalizeMediaUrl(comment.authorImageUrl)
            }))
        };
    }

    private normalizeStory(story: StoryDto): StoryDto {
        return {
            ...story,
            authorImageUrl: this.normalizeMediaUrl(story.authorImageUrl),
            mediaUrl: this.normalizeMediaUrl(story.mediaUrl) ?? story.mediaUrl
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
            authorImageUrl: this.normalizeMediaUrl(reel.authorImageUrl),
            videoUrl: this.normalizeMediaUrl(reel.videoUrl) ?? reel.videoUrl,
            thumbnailUrl: this.normalizeMediaUrl(reel.thumbnailUrl),
            comments: (reel.comments ?? []).map(comment => ({
                ...comment,
                authorImageUrl: this.normalizeMediaUrl(comment.authorImageUrl)
            }))
        };
    }

    private emitAppChange(change: 'profile' | 'posts' | 'session' | 'notifications'): void {
        this.ngZone.run(() => this.appChanges.next(change));
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

        if (trimmed.startsWith('data:')) {
            return trimmed;
        }

        if (trimmed.startsWith('/')) {
            return this.apiOrigin ? `${this.apiOrigin}${trimmed}` : trimmed;
        }

        try {
            const parsed = new URL(trimmed);
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
            return undefined;
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
