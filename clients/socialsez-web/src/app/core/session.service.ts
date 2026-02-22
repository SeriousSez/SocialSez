import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import {
    AuthResponse,
    ChatConversationDto,
    ChatMessageDto,
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
    RegisterRequest,
    UpdateProfileRequest
} from './api.types';
import { SocialSezApiService } from './socialsez-api.service';

@Injectable({ providedIn: 'root' })
export class SessionService {
    profile: ProfileDto | null = null;
    message = '';
    nextSilentRefreshAt: Date | null = null;

    private readonly appChanges = new ReplaySubject<'profile' | 'posts' | 'session' | 'notifications'>(1);
    readonly appChanges$ = this.appChanges.asObservable();

    private silentRefreshTimerId: number | undefined;
    private bootstrapPromise: Promise<void> | null = null;
    private bootstrapped = false;

    constructor(
        private readonly api: SocialSezApiService,
        private readonly router: Router,
    ) { }

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
            this.message = 'Session restored.';
            this.appChanges.next('session');
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
        this.appChanges.next('session');
        await this.router.navigateByUrl('/feed');
    }

    async loginAsync(request: LoginRequest): Promise<void> {
        const auth = await firstValueFrom(this.api.login(request));
        this.applyAuth(auth);
        this.message = 'Logged in.';
        this.appChanges.next('session');
        await this.router.navigateByUrl('/feed');
    }

    async logoutAsync(): Promise<void> {
        try {
            await firstValueFrom(this.api.revokeSession());
        } finally {
            this.clearSession();
            this.message = 'Logged out.';
            this.appChanges.next('session');
            await this.router.navigateByUrl('/auth');
        }
    }

    async refreshSessionAsync(silent = false): Promise<void> {
        const auth = await firstValueFrom(this.api.refreshSession());
        this.applyAuth(auth);
        if (!silent) {
            this.message = 'Session refreshed.';
            this.appChanges.next('session');
        }
    }

    async loadFeedAsync(): Promise<PostDto[]> {
        return firstValueFrom(this.api.getFeed());
    }

    async loadPostsByHashtagAsync(hashtag: string): Promise<PostDto[]> {
        return firstValueFrom(this.api.getPostsByHashtag(hashtag));
    }

    async loadPostsByAuthorHandleAsync(handle: string): Promise<PostDto[]> {
        return firstValueFrom(this.api.getPostsByAuthorHandle(handle));
    }

    async searchPostsAsync(query: string): Promise<PostDto[]> {
        return firstValueFrom(this.api.searchPosts(query));
    }

    async searchHashtagsAsync(query: string): Promise<HashtagSearchResultDto[]> {
        return firstValueFrom(this.api.searchHashtags(query));
    }

    async loadTrendingHashtagsAsync(take = 10): Promise<HashtagSearchResultDto[]> {
        return firstValueFrom(this.api.getTrendingHashtags(take));
    }

    async searchProfilesAsync(query: string): Promise<ProfileDto[]> {
        return firstValueFrom(this.api.searchProfiles(query));
    }

    async createPostAsync(content: string, imageFile?: File): Promise<void> {
        await firstValueFrom(this.api.createPost(content, imageFile));
        this.message = 'Post created.';
        this.appChanges.next('posts');
    }

    async updatePostAsync(postId: string, content: string): Promise<void> {
        await firstValueFrom(this.api.updatePost(postId, { content }));
        this.message = 'Post updated.';
        this.appChanges.next('posts');
    }

    async deletePostAsync(postId: string): Promise<void> {
        await firstValueFrom(this.api.deletePost(postId));
        this.message = 'Post deleted.';
        this.appChanges.next('posts');
    }

    async togglePostLikeAsync(postId: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.togglePostLike(postId));
        return updated;
    }

    async setPostReactionAsync(postId: string, reactionType: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.setPostReaction(postId, { type: reactionType }));
        return updated;
    }

    async clearPostReactionAsync(postId: string): Promise<PostDto> {
        const updated = await firstValueFrom(this.api.clearPostReaction(postId));
        return updated;
    }

    async addCommentAsync(postId: string, content: string): Promise<PostDto> {
        return firstValueFrom(this.api.addComment(postId, content));
    }

    async updateCommentAsync(postId: string, commentId: string, content: string): Promise<PostDto> {
        return firstValueFrom(this.api.updateComment(postId, commentId, content));
    }

    async deleteCommentAsync(postId: string, commentId: string): Promise<PostDto> {
        return firstValueFrom(this.api.deleteComment(postId, commentId));
    }

    async setCommentReactionAsync(postId: string, commentId: string, reactionType: string): Promise<PostDto> {
        return firstValueFrom(this.api.setCommentReaction(postId, commentId, { type: reactionType }));
    }

    async clearCommentReactionAsync(postId: string, commentId: string): Promise<PostDto> {
        return firstValueFrom(this.api.clearCommentReaction(postId, commentId));
    }

    async uploadImageAsync(file: File): Promise<string> {
        const response = await firstValueFrom(this.api.uploadImage(file));
        return response.url;
    }

    async loadPublicProfileAsync(handle: string): Promise<ProfileDto> {
        return firstValueFrom(this.api.getProfile(handle));
    }

    async loadProfileActivitySummaryAsync(handle: string): Promise<ProfileActivitySummaryDto> {
        return firstValueFrom(this.api.getProfileActivitySummary(handle));
    }

    async followAsync(followedId: string): Promise<FollowActionResultDto> {
        const result = await firstValueFrom(this.api.follow(followedId));
        this.message = result.status === 'RequestPending' ? 'Follow request sent.' : 'Now following user.';
        this.appChanges.next('posts');
        return result;
    }

    async unfollowAsync(followedId: string): Promise<void> {
        await firstValueFrom(this.api.unfollow(followedId));
        this.message = 'Unfollowed user.';
        this.appChanges.next('posts');
    }

    async getFollowStatusAsync(followedId: string): Promise<FollowStatusDto> {
        return firstValueFrom(this.api.isFollowing(followedId));
    }

    async isFollowingAsync(followedId: string): Promise<boolean> {
        const response = await this.getFollowStatusAsync(followedId);
        return response.isFollowing;
    }

    async loadFollowingAsync(take = 100): Promise<ProfileDto[]> {
        return firstValueFrom(this.api.getFollowing(take));
    }

    async loadFollowSuggestionsAsync(takePerGroup = 10): Promise<FollowSuggestionsDto> {
        return firstValueFrom(this.api.getFollowSuggestions(takePerGroup));
    }

    async loadIncomingFollowRequestsAsync(take = 50): Promise<FollowRequestDto[]> {
        return firstValueFrom(this.api.getIncomingFollowRequests(take));
    }

    async approveFollowRequestAsync(followerId: string): Promise<void> {
        await firstValueFrom(this.api.approveFollowRequest(followerId));
        this.appChanges.next('notifications');
    }

    async declineFollowRequestAsync(followerId: string): Promise<void> {
        await firstValueFrom(this.api.declineFollowRequest(followerId));
        this.appChanges.next('notifications');
    }

    async loadNotificationsAsync(take = 50): Promise<NotificationDto[]> {
        return firstValueFrom(this.api.getNotifications(take));
    }

    async markNotificationReadAsync(notificationId: string): Promise<void> {
        await firstValueFrom(this.api.markNotificationRead(notificationId));
        this.appChanges.next('notifications');
    }

    async markAllNotificationsReadAsync(): Promise<number> {
        const response = await firstValueFrom(this.api.markAllNotificationsRead());
        this.appChanges.next('notifications');
        return response.updatedCount;
    }

    async updateProfileAsync(request: UpdateProfileRequest): Promise<void> {
        const updated = await firstValueFrom(this.api.updateMyProfile(request));
        this.profile = updated;
        this.message = 'Profile updated.';
        this.appChanges.next('profile');
    }

    async updateProfilePrivacyAsync(isPrivate: boolean): Promise<void> {
        const updated = await firstValueFrom(this.api.updateMyPrivacy({ isPrivate }));
        this.profile = updated;
        this.message = 'Profile privacy updated.';
        this.appChanges.next('profile');
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

    async loadChatMessagesAsync(conversationId: string, take = 50): Promise<ChatMessageDto[]> {
        return firstValueFrom(this.api.getChatMessages(conversationId, take));
    }

    async sendChatMessageAsync(conversationId: string, content: string): Promise<ChatMessageDto> {
        return firstValueFrom(this.api.sendChatMessage(conversationId, { content }));
    }

    async setMessageReactionAsync(messageId: string, reactionType: string): Promise<ChatMessageDto> {
        return firstValueFrom(this.api.setMessageReaction(messageId, { type: reactionType }));
    }

    async clearMessageReactionAsync(messageId: string): Promise<ChatMessageDto> {
        return firstValueFrom(this.api.clearMessageReaction(messageId));
    }

    async refreshMeAsync(): Promise<void> {
        const me = await firstValueFrom(this.api.getMe());
        this.profile = me;
        this.appChanges.next('profile');
    }

    private applyAuth(auth: AuthResponse): void {
        this.profile = auth.profile;
        this.scheduleSilentRefresh(auth.expiresAtUtc);
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
