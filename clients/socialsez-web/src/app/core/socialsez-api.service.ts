import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, of, switchMap, tap, throwError, timeout } from 'rxjs';
import { AuthResponse, HashtagSearchResultDto, LoginRequest, PostDto, ProfileDto, RegisterRequest, SetReactionRequest, UpdatePostRequest, UpdateProfileRequest, UploadImageResponse } from './api.types';

@Injectable({ providedIn: 'root' })
export class SocialSezApiService {
    private readonly baseUrl = 'http://localhost:5100/api';
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

    getProfile(handle: string): Observable<ProfileDto> {
        return this.http.get<ProfileDto>(`${this.baseUrl}/profiles/${handle}`);
    }

    searchProfiles(query: string, take = 20): Observable<ProfileDto[]> {
        return this.withAutoRefresh(() => this.http.get<ProfileDto[]>(`${this.baseUrl}/profiles/search?q=${encodeURIComponent(query)}&take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getMe(): Observable<ProfileDto> {
        return this.withAutoRefresh(() => this.http.get<ProfileDto>(`${this.baseUrl}/profiles/me`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    createPost(content: string, imageFile?: File): Observable<PostDto> {
        const formData = new FormData();
        formData.append('content', content);

        if (imageFile) {
            formData.append('image', imageFile);
        }

        return this.withAutoRefresh(() => this.http.post<PostDto>(`${this.baseUrl}/posts`, formData, { headers: this.authHeaders() }));
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

    addComment(postId: string, content: string): Observable<PostDto> {
        return this.withAutoRefresh(() => this.http.post<PostDto>(`${this.baseUrl}/posts/${postId}/comments`, { content }, { headers: this.authHeaders() }));
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

    getFeed(take = 25): Observable<PostDto[]> {
        return this.withAutoRefresh(() => this.http.get<PostDto[]>(`${this.baseUrl}/posts/feed?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getPostsByHashtag(hashtag: string, take = 25): Observable<PostDto[]> {
        const normalized = hashtag.trim().replace(/^#/, '');
        return this.withAutoRefresh(() => this.http.get<PostDto[]>(`${this.baseUrl}/posts/hashtags/${encodeURIComponent(normalized)}?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    getPostsByAuthorHandle(handle: string, take = 25): Observable<PostDto[]> {
        const normalized = handle.trim().toLowerCase();
        return this.withAutoRefresh(() => this.http.get<PostDto[]>(`${this.baseUrl}/posts/by-author/${encodeURIComponent(normalized)}?take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    searchPosts(query: string, take = 25): Observable<PostDto[]> {
        return this.withAutoRefresh(() => this.http.get<PostDto[]>(`${this.baseUrl}/posts/search?q=${encodeURIComponent(query)}&take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    searchHashtags(query: string, take = 20): Observable<HashtagSearchResultDto[]> {
        return this.withAutoRefresh(() => this.http.get<HashtagSearchResultDto[]>(`${this.baseUrl}/posts/hashtags/search?q=${encodeURIComponent(query)}&take=${take}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    follow(followedId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.post<void>(`${this.baseUrl}/follows`, { followedId }, { headers: this.authHeaders() }));
    }

    unfollow(followedId: string): Observable<void> {
        return this.withAutoRefresh(() => this.http.delete<void>(`${this.baseUrl}/follows?followedId=${followedId}`, { headers: this.authHeaders() }));
    }

    isFollowing(followedId: string): Observable<{ isFollowing: boolean }> {
        return this.withAutoRefresh(() => this.http.get<{ isFollowing: boolean }>(`${this.baseUrl}/follows/status?followedId=${followedId}`, { headers: this.authHeaders() }).pipe(timeout(15000)));
    }

    updateMyProfile(request: UpdateProfileRequest): Observable<ProfileDto> {
        return this.withAutoRefresh(() => this.http.put<ProfileDto>(`${this.baseUrl}/profiles/me`, request, { headers: this.authHeaders() }));
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
}
