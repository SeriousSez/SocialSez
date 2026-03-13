import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, of, switchMap, tap, throwError, timeout } from 'rxjs';
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
    CreateChatMessageRequest,
    CreateDirectConversationRequest,
    CreateGroupConversationRequest,
    FollowActionResultDto,
    FollowRequestDto,
    FollowedHashtagDto,
    FollowStatusDto,
    FollowSuggestionsDto,
    FeedMode,
    HashtagContentDto,
    HashtagSearchResultDto,
    LoginRequest,
    MarkAllReadResponse,
    NotificationDto,
    PostDto,
    ProfileActivitySummaryDto,
    ProfileDto,
    ReelDto,
    RevokeOtherSessionsResponse,
    RegisterRequest,
    SafetyStatusDto,
    SetMessageReactionRequest,
    SetConversationMuteRequest,
    SetReactionRequest,
    StoryDto,
    StoryGroupDto,
    UpdateChatMessageRequest,
    UpdateGroupConversationTitleRequest,
    UpdatePostRequest,
    UpdateProfilePrivacyRequest,
    UpdateProfileRequest,
    UploadImageResponse
} from './api.types';

@Injectable({ providedIn: 'root' })
export class SocialSezApiService {
    private readonly baseUrl = environment.apiBaseUrl;
    private token = '';
    private refreshToken = '';

    constructor(private readonly http: HttpClient) {
        this.token = localStorage.getItem('socialsez.accessToken') ?? '';
        this.refreshToken = localStorage.getItem('socialsez.refreshToken') ?? '';
    }

    private setSession(auth: AuthResponse): void {
        this.token = auth.token;
        this.refreshToken = auth.refreshToken;
        localStorage.setItem('socialsez.accessToken', auth.token);
        localStorage.setItem('socialsez.refreshToken', auth.refreshToken);
    }

    clearToken(): void {
        this.token = '';
        this.refreshToken = '';
        localStorage.removeItem('socialsez.accessToken');
        localStorage.removeItem('socialsez.refreshToken');
    }

    register(request: RegisterRequest): Observable<AuthResponse> {
        return this.http.post<AuthResponse>(`${this.baseUrl}/auth/register`, request).pipe(
            tap(auth => this.setSession(auth))
        );
    }

    login(request: LoginRequest): Observable<AuthResponse> {
        return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, request).pipe(
            tap(auth => this.setSession(auth))
        );
    }

    refreshSession(): Observable<AuthResponse> {
        if (!this.refreshToken) {
            return throwError(() => new Error('No refresh token available.'));
        }

        return this.http.post<AuthResponse>(`${this.baseUrl}/auth/refresh`, {
            refreshToken: this.refreshToken
        }).pipe(
            timeout(15000),
            tap(auth => this.setSession(auth))
        );
    }

    revokeSession(): Observable<void> {
        if (!this.refreshToken) {
            this.clearToken();
            return of(void 0);
        }

        return this.http.post<void>(`${this.baseUrl}/auth/revoke`, {
            refreshToken: this.refreshToken
        }).pipe(
            catchError(() => of(void 0)),
            switchMap(() => {
                this.clearToken();
                return of(void 0);
            })
        );
    }

    getAuthSessions(): Observable<AuthSessionDto[]> {
        return this.withAutoRefresh(() => this.http.post<AuthSessionDto[]>(`${this.baseUrl}/auth/sessions`, {
            refreshToken: this.refreshToken || null
        }, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    revokeAuthSessionById(sessionId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/auth/sessions/revoke`, {
            sessionId
        }, { headers: this.authHeaders() }));
    }

    revokeOtherAuthSessions(): Observable<RevokeOtherSessionsResponse> {
        return this.withAutoRefresh(() => this.http.post<RevokeOtherSessionsResponse>(`${this.baseUrl}/auth/sessions/revoke-others`, {
            refreshToken: this.refreshToken || null
        }, { headers: this.authHeaders() }));
    }

    deactivateMyAccount(): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/auth/account/deactivate`, {}, { headers: this.authHeaders() }));
    }

    deleteMyAccount(): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/auth/account`, { headers: this.authHeaders() }));
    }

    getProfile(handle: string): Observable<ProfileDto> {
        return this.http.get<ProfileDto>(`${this.baseUrl}/profiles/${handle}`);
    }

    getProfileActivitySummary(handle: string): Observable<ProfileActivitySummaryDto> {
        return this.http.get<ProfileActivitySummaryDto>(`${this.baseUrl}/profiles/${encodeURIComponent(handle)}/activity`);
    }

    searchProfiles(query: string, take = 20): Observable<ProfileDto[]> {
        return this.withAutoRefresh(() => this.http.get<ProfileDto[]>(`${this.baseUrl}/profiles/search?q=${encodeURIComponent(query)}&take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getMe(): Observable<ProfileDto> {
        return this.withAutoRefresh(() => this.http.get<ProfileDto>(`${this.baseUrl}/profiles/me`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    createPost(content: string, imageFiles?: File[], isSensitive = false): Observable<PostDto> {
        const formData = new FormData();
        formData.append('content', content);
        formData.append('isSensitive', `${isSensitive}`);

        if (imageFiles?.length) {
            for (const imageFile of imageFiles) {
                formData.append('images', imageFile);
            }
        }

        return this.withAutoRefresh(() => this.http.post<PostDto>(`${this.baseUrl}/posts`, formData, { headers: this.authHeaders() }));
    }

    createStory(mediaFile: File, caption?: string, isSensitive = false): Observable<StoryDto> {
        const formData = new FormData();
        formData.append('media', mediaFile);
        formData.append('isSensitive', `${isSensitive}`);

        if (caption?.trim()) {
            formData.append('caption', caption.trim());
        }

        return this.withAutoRefresh(() => this.http.post<StoryDto>(`${this.baseUrl}/stories`, formData, { headers: this.authHeaders() }));
    }

    deleteStory(storyId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/stories/${storyId}`, { headers: this.authHeaders() }));
    }

    createReel(videoFile: File, durationSeconds: number, caption?: string, thumbnailFile?: File, isSensitive = false): Observable<ReelDto> {
        const formData = new FormData();
        formData.append('video', videoFile);
        formData.append('durationSeconds', `${Math.max(1, Math.round(durationSeconds))}`);
        formData.append('isSensitive', `${isSensitive}`);

        if (caption?.trim()) {
            formData.append('caption', caption.trim());
        }

        if (thumbnailFile) {
            formData.append('thumbnail', thumbnailFile);
        }

        return this.withAutoRefresh(() => this.http.post<ReelDto>(`${this.baseUrl}/reels`, formData, { headers: this.authHeaders() }));
    }

    updateReel(reelId: string, caption?: string): Observable<ReelDto> {
        return this.withAutoRefresh(() => this.http.put<ReelDto>(`${this.baseUrl}/reels/${reelId}`, { caption }, { headers: this.authHeaders() }));
    }

    deleteReel(reelId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/reels/${reelId}`, { headers: this.authHeaders() }));
    }

    updatePost(postId: string, request: UpdatePostRequest): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.put<PostDto>(`${this.baseUrl}/posts/${postId}`, request, { headers: this.authHeaders() }));
    }

    deletePost(postId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/posts/${postId}`, { headers: this.authHeaders() }));
    }

    togglePostLike(postId: string): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.post<PostDto>(`${this.baseUrl}/posts/${postId}/like`, {}, { headers: this.authHeaders() }));
    }

    setPostReaction(postId: string, request: SetReactionRequest): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.post<PostDto>(`${this.baseUrl}/posts/${postId}/reaction`, request, { headers: this.authHeaders() }));
    }

    clearPostReaction(postId: string): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.delete<PostDto>(`${this.baseUrl}/posts/${postId}/reaction`, { headers: this.authHeaders() }));
    }

    addComment(postId: string, content: string, parentCommentId?: string | null): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.post<PostDto>(`${this.baseUrl}/posts/${postId}/comments`, { content, parentCommentId: parentCommentId ?? null }, { headers: this.authHeaders() }));
    }

    updateComment(postId: string, commentId: string, content: string): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.put<PostDto>(`${this.baseUrl}/posts/${postId}/comments/${commentId}`, { content }, { headers: this.authHeaders() }));
    }

    deleteComment(postId: string, commentId: string): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.delete<PostDto>(`${this.baseUrl}/posts/${postId}/comments/${commentId}`, { headers: this.authHeaders() }));
    }

    setCommentReaction(postId: string, commentId: string, request: SetReactionRequest): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.post<PostDto>(`${this.baseUrl}/posts/${postId}/comments/${commentId}/reaction`, request, { headers: this.authHeaders() }));
    }

    clearCommentReaction(postId: string, commentId: string): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.delete<PostDto>(`${this.baseUrl}/posts/${postId}/comments/${commentId}/reaction`, { headers: this.authHeaders() }));
    }

    uploadImage(file: File): Observable<UploadImageResponse> {
        const formData = new FormData();
        formData.append('file', file);
        return this.withAutoRefresh(() => this.http.post<UploadImageResponse>(`${this.baseUrl}/uploads/images`, formData, { headers: this.authHeaders() }).pipe(timeout(20000)));
    }

    getMyBlogs(): Observable<BlogDto[]> {
        return this.withAutoRefresh(() => this.http.get<BlogDto[]>(`${this.baseUrl}/blogs/mine`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    discoverBlogs(query?: string, take = 60): Observable<BlogDto[]> {
        const params: string[] = [];
        if (query && query.trim()) {
            params.push(`q=${encodeURIComponent(query.trim())}`);
        }

        params.push(`take=${take}`);
        const queryString = params.length > 0 ? `?${params.join('&')}` : '';
        return this.http.get<BlogDto[]>(`${this.baseUrl}/blogs/discover${queryString}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getFollowingBlogs(query?: string, take = 60): Observable<BlogDto[]> {
        const params: string[] = [];
        if (query && query.trim()) {
            params.push(`q=${encodeURIComponent(query.trim())}`);
        }

        params.push(`take=${take}`);
        const queryString = params.length > 0 ? `?${params.join('&')}` : '';
        return this.withAutoRefresh(() => this.http.get<BlogDto[]>(`${this.baseUrl}/blogs/following${queryString}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getBlogsByAuthorHandle(handle: string): Observable<BlogDto[]> {
        return this.http.get<BlogDto[]>(`${this.baseUrl}/blogs/by-author/${encodeURIComponent(handle)}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getBlogByAuthorAndSlug(handle: string, blogSlug: string): Observable<BlogDto> {
        return this.http.get<BlogDto>(`${this.baseUrl}/blogs/${encodeURIComponent(handle)}/${encodeURIComponent(blogSlug)}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getBlogPosts(handle: string, blogSlug: string): Observable<BlogPostDto[]> {
        return this.http.get<BlogPostDto[]>(`${this.baseUrl}/blogs/${encodeURIComponent(handle)}/${encodeURIComponent(blogSlug)}/posts`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getBlogPost(handle: string, blogSlug: string, postSlug: string): Observable<BlogPostDto> {
        return this.http.get<BlogPostDto>(`${this.baseUrl}/blogs/${encodeURIComponent(handle)}/${encodeURIComponent(blogSlug)}/posts/${encodeURIComponent(postSlug)}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    createBlog(title: string, description: string | null, slug: string | null, isPublic: boolean, allowLikes: boolean, allowComments: boolean, allowShares: boolean, allowEmbeds: boolean, theme: BlogThemeConfigDto | null): Observable<BlogDto> {
        return this.withAutoRefresh(() => this.http.post<BlogDto>(`${this.baseUrl}/blogs`, { title, description, slug, isPublic, allowLikes, allowComments, allowShares, allowEmbeds, theme }, { headers: this.authHeaders() }));
    }

    updateBlog(blogId: string, title: string, description: string | null, slug: string | null, isPublic: boolean, allowLikes: boolean, allowComments: boolean, allowShares: boolean, allowEmbeds: boolean, theme: BlogThemeConfigDto | null): Observable<BlogDto> {
        return this.withAutoRefresh(() => this.http.put<BlogDto>(`${this.baseUrl}/blogs/${encodeURIComponent(blogId)}`, { title, description, slug, isPublic, allowLikes, allowComments, allowShares, allowEmbeds, theme }, { headers: this.authHeaders() }));
    }

    deleteBlog(blogId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/blogs/${encodeURIComponent(blogId)}`, { headers: this.authHeaders() }));
    }

    createBlogPost(blogId: string, title: string, content: string, excerpt: string | null, coverImageUrl: string | null, tags: string[] | null, isPublished: boolean, slug: string | null): Observable<BlogPostDto> {
        return this.withAutoRefresh(() => this.http.post<BlogPostDto>(`${this.baseUrl}/blogs/${encodeURIComponent(blogId)}/posts`, { title, content, excerpt, coverImageUrl, tags, isPublished, slug }, { headers: this.authHeaders() }));
    }

    updateBlogPost(blogId: string, postId: string, title: string, content: string, excerpt: string | null, coverImageUrl: string | null, tags: string[] | null, isPublished: boolean, slug: string | null): Observable<BlogPostDto> {
        return this.withAutoRefresh(() => this.http.put<BlogPostDto>(`${this.baseUrl}/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, { title, content, excerpt, coverImageUrl, tags, isPublished, slug }, { headers: this.authHeaders() }));
    }

    deleteBlogPost(blogId: string, postId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, { headers: this.authHeaders() }));
    }

    getFeed(take = 25, mode: FeedMode = 'for-you'): Observable<PostDto[]> {
        return this.withAutoRefresh(() => this.http.get<PostDto[]>(`${this.baseUrl}/posts/feed?take=${take}&mode=${mode}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getPostsByHashtag(hashtag: string, take = 25): Observable<PostDto[]> {
        const normalized = hashtag.trim().replace(/^#/, '');
        return this.http.get<PostDto[]>(`${this.baseUrl}/posts/hashtags/${encodeURIComponent(normalized)}?take=${take}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getHashtagContent(hashtag: string, takePerType = 25): Observable<HashtagContentDto> {
        const normalized = hashtag.trim().replace(/^#/, '');
        return this.http.get<HashtagContentDto>(`${this.baseUrl}/posts/hashtags/${encodeURIComponent(normalized)}/content?takePerType=${takePerType}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getFollowedHashtags(take = 20): Observable<FollowedHashtagDto[]> {
        return this.withAutoRefresh(() => this.http.get<FollowedHashtagDto[]>(`${this.baseUrl}/posts/hashtags/following?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    followHashtag(hashtag: string): Observable<FollowedHashtagDto> {
        const normalized = hashtag.trim().replace(/^#/, '');
        return this.withAutoRefresh(() => this.http.post<FollowedHashtagDto>(`${this.baseUrl}/posts/hashtags/${encodeURIComponent(normalized)}/follow`, {}, { headers: this.authHeaders() }));
    }

    unfollowHashtag(hashtag: string): Observable<void> {
        const normalized = hashtag.trim().replace(/^#/, '');
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/posts/hashtags/${encodeURIComponent(normalized)}/follow`, { headers: this.authHeaders() }));
    }

    getPostsByAuthorHandle(handle: string, take = 25): Observable<PostDto[]> {
        const normalized = handle.trim().toLowerCase();
        return this.withAutoRefresh(() => this.http.get<PostDto[]>(`${this.baseUrl}/posts/by-author/${encodeURIComponent(normalized)}?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getPublicPostsByAuthorHandle(handle: string, take = 25): Observable<PostDto[]> {
        const normalized = handle.trim().toLowerCase();
        return this.http.get<PostDto[]>(`${this.baseUrl}/posts/by-author/${encodeURIComponent(normalized)}/public?take=${take}`).pipe(timeout(15000));
    }

    getPublicPost(postId: string): Observable<PostDto> {
        return this.http.get<PostDto>(`${this.baseUrl}/posts/${encodeURIComponent(postId)}/public`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getSharedCommunityPost(postId: string): Observable<CommunityPostDto> {
        return this.http.get<CommunityPostDto>(`${this.baseUrl}/communities/posts/${encodeURIComponent(postId)}/shared`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    searchPosts(query: string, take = 25): Observable<PostDto[]> {
        return this.http.get<PostDto[]>(`${this.baseUrl}/posts/search?q=${encodeURIComponent(query)}&take=${take}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    searchHashtags(query: string, take = 20): Observable<HashtagSearchResultDto[]> {
        return this.http.get<HashtagSearchResultDto[]>(`${this.baseUrl}/posts/hashtags/search?q=${encodeURIComponent(query)}&take=${take}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getTrendingHashtags(take = 10): Observable<HashtagSearchResultDto[]> {
        return this.http.get<HashtagSearchResultDto[]>(`${this.baseUrl}/posts/hashtags/trending?take=${take}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getStoryFeed(takeAuthors = 25, mode: FeedMode = 'for-you'): Observable<StoryGroupDto[]> {
        return this.withAutoRefresh(() => this.http.get<StoryGroupDto[]>(`${this.baseUrl}/stories/feed?takeAuthors=${takeAuthors}&mode=${mode}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    markStoryViewed(storyId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/stories/${storyId}/view`, {}, { headers: this.authHeaders() }));
    }

    getReelFeed(take = 20, mode: FeedMode = 'for-you'): Observable<ReelDto[]> {
        return this.withAutoRefresh(() => this.http.get<ReelDto[]>(`${this.baseUrl}/reels/feed?take=${take}&mode=${mode}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getReelsByAuthorHandle(handle: string, take = 25): Observable<ReelDto[]> {
        const normalized = handle.trim().toLowerCase();
        return this.withAutoRefresh(() => this.http.get<ReelDto[]>(`${this.baseUrl}/reels/by-author/${encodeURIComponent(normalized)}?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getPublicReelsByAuthorHandle(handle: string, take = 25): Observable<ReelDto[]> {
        const normalized = handle.trim().toLowerCase();
        return this.http.get<ReelDto[]>(`${this.baseUrl}/reels/by-author/${encodeURIComponent(normalized)}/public?take=${take}`).pipe(timeout(15000));
    }

    getPublicStoriesByAuthorHandle(handle: string): Observable<StoryGroupDto> {
        const normalized = handle.trim().toLowerCase();
        return this.http.get<StoryGroupDto>(`${this.baseUrl}/stories/by-author/${encodeURIComponent(normalized)}/public`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getPublicReel(reelId: string): Observable<ReelDto> {
        return this.http.get<ReelDto>(`${this.baseUrl}/reels/${encodeURIComponent(reelId)}/public`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getPublicStory(storyId: string): Observable<StoryDto> {
        return this.http.get<StoryDto>(`${this.baseUrl}/stories/${encodeURIComponent(storyId)}/public`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    toggleReelLike(reelId: string): Observable<ReelDto> {
        return this.withAutoRefresh(() => this.http.post<ReelDto>(`${this.baseUrl}/reels/${reelId}/like`, {}, { headers: this.authHeaders() }));
    }

    addReelComment(reelId: string, content: string, parentCommentId?: string | null): Observable<ReelDto> {
        return this.withAutoRefresh(() => this.http.post<ReelDto>(`${this.baseUrl}/reels/${reelId}/comments`, { content, parentCommentId: parentCommentId ?? null }, { headers: this.authHeaders() }));
    }

    updateReelComment(reelId: string, commentId: string, content: string): Observable<ReelDto> {
        return this.withAutoRefresh(() => this.http.put<ReelDto>(`${this.baseUrl}/reels/${reelId}/comments/${commentId}`, { content }, { headers: this.authHeaders() }));
    }

    deleteReelComment(reelId: string, commentId: string): Observable<ReelDto> {
        return this.withAutoRefresh(() => this.http.delete<ReelDto>(`${this.baseUrl}/reels/${reelId}/comments/${commentId}`, { headers: this.authHeaders() }));
    }

    toggleReelCommentLike(reelId: string, commentId: string): Observable<ReelDto> {
        return this.withAutoRefresh(() => this.http.post<ReelDto>(`${this.baseUrl}/reels/${reelId}/comments/${commentId}/like`, {}, { headers: this.authHeaders() }));
    }

    follow(followedId: string): Observable<FollowActionResultDto> {
        return this.withAutoRefresh(() => this.http.post<FollowActionResultDto>(`${this.baseUrl}/follows`, { followedId }, { headers: this.authHeaders() }));
    }

    unfollow(followedId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/follows?followedId=${followedId}`, { headers: this.authHeaders() }));
    }

    isFollowing(followedId: string): Observable<FollowStatusDto> {
        return this.withAutoRefresh(() => this.http.get<FollowStatusDto>(`${this.baseUrl}/follows/status?followedId=${followedId}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getIncomingFollowRequests(take = 50): Observable<FollowRequestDto[]> {
        return this.withAutoRefresh(() => this.http.get<FollowRequestDto[]>(`${this.baseUrl}/follows/requests/incoming?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    approveFollowRequest(followerId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/follows/requests/${followerId}/approve`, {}, { headers: this.authHeaders() }));
    }

    declineFollowRequest(followerId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/follows/requests/${followerId}/decline`, {}, { headers: this.authHeaders() }));
    }

    getFollowing(take = 100): Observable<ProfileDto[]> {
        return this.withAutoRefresh(() => this.http.get<ProfileDto[]>(`${this.baseUrl}/follows/following?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getFollowSuggestions(takePerGroup = 10): Observable<FollowSuggestionsDto> {
        return this.withAutoRefresh(() => this.http.get<FollowSuggestionsDto>(`${this.baseUrl}/follows/suggestions?takePerGroup=${takePerGroup}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getSafetyStatus(targetProfileId: string): Observable<SafetyStatusDto> {
        return this.withAutoRefresh(() => this.http.get<SafetyStatusDto>(`${this.baseUrl}/safety/status?targetProfileId=${encodeURIComponent(targetProfileId)}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getBlockedProfiles(take = 100): Observable<ProfileDto[]> {
        return this.withAutoRefresh(() => this.http.get<ProfileDto[]>(`${this.baseUrl}/safety/blocked?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    blockProfile(targetProfileId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/block`, { targetProfileId }, { headers: this.authHeaders() }));
    }

    unblockProfile(targetProfileId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/safety/block?targetProfileId=${encodeURIComponent(targetProfileId)}`, { headers: this.authHeaders() }));
    }

    muteProfile(targetProfileId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/mute`, { targetProfileId }, { headers: this.authHeaders() }));
    }

    unmuteProfile(targetProfileId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/safety/mute?targetProfileId=${encodeURIComponent(targetProfileId)}`, { headers: this.authHeaders() }));
    }

    reportProfile(targetProfileId: string, reason: string, details?: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/report`, { targetProfileId, reason, details }, { headers: this.authHeaders() }));
    }

    reportPost(targetPostId: string, reason: string, details?: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/report/post`, { targetPostId, reason, details }, { headers: this.authHeaders() }));
    }

    reportReel(targetReelId: string, reason: string, details?: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/report/reel`, { targetReelId, reason, details }, { headers: this.authHeaders() }));
    }

    reportStory(targetStoryId: string, reason: string, details?: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/report/story`, { targetStoryId, reason, details }, { headers: this.authHeaders() }));
    }

    reportComment(targetCommentId: string, reason: string, details?: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/report/comment`, { targetCommentId, reason, details }, { headers: this.authHeaders() }));
    }

    reportReelComment(targetReelCommentId: string, reason: string, details?: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/report/reel-comment`, { targetReelCommentId, reason, details }, { headers: this.authHeaders() }));
    }

    reportMessage(targetMessageId: string, reason: string, details?: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/safety/report/message`, { targetMessageId, reason, details }, { headers: this.authHeaders() }));
    }

    updateMyProfile(request: UpdateProfileRequest): Observable<ProfileDto> {
        return this.withAutoRefresh(() => this.http.put<ProfileDto>(`${this.baseUrl}/profiles/me`, request, { headers: this.authHeaders() }));
    }

    updateMyPrivacy(request: UpdateProfilePrivacyRequest): Observable<ProfileDto> {
        return this.withAutoRefresh(() => this.http.put<ProfileDto>(`${this.baseUrl}/profiles/me/privacy`, request, { headers: this.authHeaders() }));
    }

    getNotifications(take = 50): Observable<NotificationDto[]> {
        return this.withAutoRefresh(() => this.http.get<NotificationDto[]>(`${this.baseUrl}/notifications?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    markNotificationRead(notificationId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/notifications/${notificationId}/read`, {}, { headers: this.authHeaders() }));
    }

    markAllNotificationsRead(): Observable<MarkAllReadResponse> {
        return this.withAutoRefresh(() => this.http.post<MarkAllReadResponse>(`${this.baseUrl}/notifications/read-all`, {}, { headers: this.authHeaders() }));
    }

    getChatConversations(): Observable<ChatConversationDto[]> {
        return this.withAutoRefresh(() => this.http.get<ChatConversationDto[]>(`${this.baseUrl}/chat/conversations`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    createOrGetDirectConversation(request: CreateDirectConversationRequest): Observable<ChatConversationDto> {
        return this.withAutoRefresh(() => this.http.post<ChatConversationDto>(`${this.baseUrl}/chat/conversations/direct`, request, { headers: this.authHeaders() }));
    }

    createGroupConversation(request: CreateGroupConversationRequest): Observable<ChatConversationDto> {
        return this.withAutoRefresh(() => this.http.post<ChatConversationDto>(`${this.baseUrl}/chat/conversations/group`, request, { headers: this.authHeaders() }));
    }

    updateGroupConversationTitle(conversationId: string, request: UpdateGroupConversationTitleRequest): Observable<ChatConversationDto> {
        return this.withAutoRefresh(() => this.http.put<ChatConversationDto>(`${this.baseUrl}/chat/conversations/${conversationId}/title`, request, { headers: this.authHeaders() }));
    }

    leaveGroupConversation(conversationId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/chat/conversations/${conversationId}/members/me`, { headers: this.authHeaders() }));
    }

    setConversationMute(conversationId: string, request: SetConversationMuteRequest): Observable<ChatConversationDto> {
        return this.withAutoRefresh(() => this.http.put<ChatConversationDto>(`${this.baseUrl}/chat/conversations/${conversationId}/mute`, request, { headers: this.authHeaders() }));
    }

    getChatMessages(conversationId: string, take = 50, skip = 0): Observable<ChatMessageDto[]> {
        return this.withAutoRefresh(() => this.http.get<ChatMessageDto[]>(`${this.baseUrl}/chat/conversations/${conversationId}/messages?take=${take}&skip=${skip}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    sendChatMessage(conversationId: string, request: CreateChatMessageRequest): Observable<ChatMessageDto> {
        return this.withAutoRefresh(() => this.http.post<ChatMessageDto>(`${this.baseUrl}/chat/conversations/${conversationId}/messages`, request, { headers: this.authHeaders() }));
    }

    updateChatMessage(messageId: string, request: UpdateChatMessageRequest): Observable<ChatMessageDto> {
        return this.withAutoRefresh(() => this.http.put<ChatMessageDto>(`${this.baseUrl}/chat/messages/${messageId}`, request, { headers: this.authHeaders() }));
    }

    setMessageReaction(messageId: string, request: SetMessageReactionRequest): Observable<ChatMessageDto> {
        return this.withAutoRefresh(() => this.http.post<ChatMessageDto>(`${this.baseUrl}/chat/messages/${messageId}/reaction`, request, { headers: this.authHeaders() }));
    }

    clearMessageReaction(messageId: string): Observable<ChatMessageDto> {
        return this.withAutoRefresh(() => this.http.delete<ChatMessageDto>(`${this.baseUrl}/chat/messages/${messageId}/reaction`, { headers: this.authHeaders() }));
    }

    createCommunity(name: string, description: string | null, rules: CommunityRuleDto[] | null, imageUrl: string | null, isPrivate: boolean): Observable<CommunityDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityDto>(`${this.baseUrl}/communities`, { name, description, rules, imageUrl, isPrivate }, { headers: this.authHeaders() }));
    }

    updateCommunity(communityId: string, name: string, description: string | null, rules: CommunityRuleDto[] | null, imageUrl: string | null, isPrivate: boolean): Observable<CommunityDto> {
        return this.withAutoRefresh(() => this.http.put<CommunityDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}`, { name, description, rules, imageUrl, isPrivate }, { headers: this.authHeaders() }));
    }

    getCommunityById(communityId: string, members = 20): Observable<CommunityDto> {
        return this.http.get<CommunityDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}?members=${members}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getCommunityBySlug(slug: string, members = 20): Observable<CommunityDto> {
        const normalizedSlug = slug
            .trim()
            .replace(/_/g, '-')
            .split(/\s+/g)
            .filter(part => part.length > 0)
            .join('-')
            .toLowerCase();

        return this.http.get<CommunityDto>(`${this.baseUrl}/communities/slug/${encodeURIComponent(normalizedSlug)}?members=${members}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    getMyCommunities(take = 50): Observable<CommunityDto[]> {
        return this.withAutoRefresh(() => this.http.get<CommunityDto[]>(`${this.baseUrl}/communities/mine?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    discoverCommunities(query?: string, take = 50): Observable<CommunityDto[]> {
        const q = query?.trim();
        const queryString = q ? `q=${encodeURIComponent(q)}&` : '';
        return this.http.get<CommunityDto[]>(`${this.baseUrl}/communities/discover?${queryString}take=${take}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    searchCommunityPosts(query: string, take = 50): Observable<CommunityPostDto[]> {
        const q = query.trim();
        const queryString = q ? `q=${encodeURIComponent(q)}&` : '';
        return this.http.get<CommunityPostDto[]>(`${this.baseUrl}/communities/posts/search?${queryString}take=${take}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    joinCommunity(communityId: string): Observable<CommunityDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/join`, {}, { headers: this.authHeaders() }));
    }

    leaveCommunity(communityId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/leave`, {}, { headers: this.authHeaders() }));
    }

    updateCommunityMemberRole(communityId: string, memberProfileId: string, role: 'Member' | 'Moderator'): Observable<CommunityDto> {
        return this.withAutoRefresh(() => this.http.put<CommunityDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(memberProfileId)}/role`, { role }, { headers: this.authHeaders() }));
    }

    timeoutCommunityMember(communityId: string, memberProfileId: string, durationDays: 1 | 7 | 30): Observable<CommunityDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(memberProfileId)}/timeout`, { durationDays }, { headers: this.authHeaders() }));
    }

    createCommunityPost(
        communityId: string,
        title: string | null,
        linkUrl: string | null,
        content: string | null,
        mediaContent: string | null,
        imageUrls: string[] | null,
        pollQuestion: string | null,
        pollOptions: string[] | null
    ): Observable<CommunityPostDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityPostDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts`, {
            title,
            linkUrl,
            content,
            mediaContent,
            imageUrls,
            pollQuestion,
            pollOptions
        }, { headers: this.authHeaders() }));
    }

    addCommunityPostComment(communityId: string, postId: string, content: string, parentCommentId?: string | null): Observable<CommunityPostDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityPostDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}/comments`, {
            content,
            parentCommentId: parentCommentId ?? null
        }, { headers: this.authHeaders() }));
    }

    updateCommunityPostComment(communityId: string, postId: string, commentId: string, content: string): Observable<CommunityPostDto> {
        return this.withAutoRefresh(() => this.http.put<CommunityPostDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, {
            content
        }, { headers: this.authHeaders() }));
    }

    deleteCommunityPostComment(communityId: string, postId: string, commentId: string): Observable<CommunityPostDto> {
        return this.withAutoRefresh(() => this.http.delete<CommunityPostDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { headers: this.authHeaders() }));
    }

    voteCommunityPost(communityId: string, postId: string, voteType?: 'Upvote' | 'Downvote'): Observable<CommunityPostDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityPostDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}/vote`, {
            voteType: voteType ?? null
        }, { headers: this.authHeaders() }));
    }

    deleteCommunityPost(communityId: string, postId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}`, { headers: this.authHeaders() }));
    }

    updateCommunityPost(
        communityId: string,
        postId: string,
        title: string | null,
        linkUrl: string | null,
        content: string | null,
        mediaContent: string | null,
        imageUrls: string[] | null,
        pollQuestion: string | null,
        pollOptions: string[] | null,
        clearPoll: boolean
    ): Observable<CommunityPostDto> {
        return this.withAutoRefresh(() => this.http.put<CommunityPostDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}`, {
            title,
            linkUrl,
            content,
            mediaContent,
            imageUrls,
            pollQuestion,
            pollOptions,
            clearPoll
        }, { headers: this.authHeaders() }));
    }

    getCommunityPosts(communityId: string, query?: string, take = 50): Observable<CommunityPostDto[]> {
        const q = query?.trim();
        const queryString = q ? `q=${encodeURIComponent(q)}&` : '';
        return this.http.get<CommunityPostDto[]>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts?${queryString}take=${take}`, { headers: this.optionalAuthHeaders() }).pipe(timeout(15000));
    }

    saveCommunityPost(communityId: string, postId: string): Observable<CommunityPostDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityPostDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}/save`, {}, { headers: this.authHeaders() }));
    }

    unsaveCommunityPost(communityId: string, postId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}/save`, { headers: this.authHeaders() }));
    }

    voteCommunityPoll(communityId: string, pollId: string, optionId: string): Observable<CommunityPollDto> {
        return this.withAutoRefresh(() => this.http.post<CommunityPollDto>(`${this.baseUrl}/communities/${encodeURIComponent(communityId)}/polls/${encodeURIComponent(pollId)}/vote`, { optionId }, { headers: this.authHeaders() }));
    }

    isAuthenticated(): boolean {
        return !!this.token;
    }

    private withAutoRefresh<T>(requestFactory: () => Observable<T>): Observable<T> {
        return requestFactory().pipe(
            catchError(error => {
                if (error.status !== 401 || !this.refreshToken) {
                    return throwError(() => error);
                }

                return this.refreshSession().pipe(
                    switchMap(() => requestFactory()),
                    catchError(inner => {
                        this.clearToken();
                        return throwError(() => inner);
                    })
                );
            })
        );
    }

    private authHeaders(): HttpHeaders {
        return new HttpHeaders({ Authorization: `Bearer ${this.token}` });
    }

    private optionalAuthHeaders(): HttpHeaders | undefined {
        return this.token ? this.authHeaders() : undefined;
    }
}
