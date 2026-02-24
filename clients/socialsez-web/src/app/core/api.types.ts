export interface ProfileDto {
    id: string;
    handle: string;
    displayName: string;
    bio: string;
    imageUrl?: string;
    isPrivate: boolean;
    createdAtUtc: string;
}

export interface ProfileActivitySummaryDto {
    postCount: number;
    followerCount: number;
    followingCount: number;
}

export interface CreateProfileRequest {
    handle: string;
    displayName: string;
    bio?: string;
}

export interface RegisterRequest {
    email: string;
    password: string;
    handle: string;
    displayName: string;
    bio?: string;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface AuthResponse {
    token: string;
    expiresAtUtc: string;
    refreshToken: string;
    refreshTokenExpiresAtUtc: string;
    profile: ProfileDto;
}

export interface UpdateProfileRequest {
    displayName: string;
    bio?: string;
    imageUrl?: string;
}

export interface UpdateProfilePrivacyRequest {
    isPrivate: boolean;
}

export interface UpdatePostRequest {
    content?: string;
}

export interface SetReactionRequest {
    type: string;
}

export interface CommentDto {
    id: string;
    postId: string;
    authorId: string;
    parentCommentId?: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    createdAtUtc: string;
    myReactionType?: string;
    reactions: ReactionSummaryDto[];
}

export interface ReactionSummaryDto {
    type: string;
    count: number;
}

export interface FollowSuggestionsDto {
    following: ProfileDto[];
    relevant: ProfileDto[];
}

export type FollowActionStatus = 'Followed' | 'RequestPending' | 'AlreadyFollowing' | 'AlreadyRequested' | 'Invalid';

export interface FollowActionResultDto {
    status: FollowActionStatus;
}

export interface FollowStatusDto {
    isFollowing: boolean;
    isRequested: boolean;
    requiresApproval: boolean;
}

export interface FollowRequestDto {
    followerId: string;
    followerHandle: string;
    followerImageUrl?: string;
    createdAtUtc: string;
    status: string;
}

export interface NotificationDto {
    id: string;
    recipientId: string;
    actorId?: string;
    actorHandle?: string;
    type: string;
    message: string;
    referenceId?: string;
    isRead: boolean;
    createdAtUtc: string;
}

export interface MarkAllReadResponse {
    updatedCount: number;
}

export interface HashtagSearchResultDto {
    tag: string;
    count: number;
}

export interface PostDto {
    id: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    imageUrl?: string;
    createdAtUtc: string;
    likeCount: number;
    likedByMe: boolean;
    myReactionType?: string;
    reactions: ReactionSummaryDto[];
    comments: CommentDto[];
}

export interface StoryDto {
    id: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    caption?: string;
    mediaUrl: string;
    createdAtUtc: string;
    expiresAtUtc: string;
    viewedByMe: boolean;
    viewCount: number;
}

export interface StoryGroupDto {
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    hasUnseenStories: boolean;
    stories: StoryDto[];
}

export interface ReelDto {
    id: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    caption?: string;
    videoUrl: string;
    thumbnailUrl?: string;
    durationSeconds: number;
    createdAtUtc: string;
    likeCount: number;
    likedByMe: boolean;
    comments: ReelCommentDto[];
}

export interface ReelCommentDto {
    id: string;
    reelId: string;
    authorId: string;
    parentCommentId?: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    createdAtUtc: string;
    likeCount: number;
    likedByMe: boolean;
}

export type FeedMode = 'for-you' | 'following';

export interface UploadImageResponse {
    url: string;
}

export interface CreateDirectConversationRequest {
    otherProfileId: string;
}

export interface CreateGroupConversationRequest {
    title?: string;
    memberProfileIds: string[];
}

export interface CreateChatMessageRequest {
    content: string;
}

export interface SetMessageReactionRequest {
    type: string;
}

export interface ChatParticipantDto {
    profileId: string;
    handle: string;
    displayName: string;
    imageUrl?: string;
    joinedAtUtc: string;
}

export interface ChatMessagePreviewDto {
    id: string;
    authorProfileId: string;
    authorHandle: string;
    content: string;
    createdAtUtc: string;
}

export interface ChatConversationDto {
    id: string;
    isGroup: boolean;
    title?: string;
    createdAtUtc: string;
    participants: ChatParticipantDto[];
    lastMessage?: ChatMessagePreviewDto;
}

export interface ChatMessageDto {
    id: string;
    conversationId: string;
    authorProfileId: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    createdAtUtc: string;
    myReactionType?: string;
    reactions: ReactionSummaryDto[];
}
