export interface ProfileDto {
    id: string;
    handle: string;
    displayName: string;
    bio: string;
    imageUrl?: string;
    isPrivate: boolean;
    createdAtUtc: string;
    handleChangeAvailableAtUtc?: string;
    dateOfBirth?: string;
    countryCode?: string;
    marketingOptIn?: boolean;
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
    dateOfBirth?: string;
    countryCode?: string;
    marketingOptIn?: boolean;
    isPrivateByDefault?: boolean;
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

export interface AuthSessionDto {
    id: string;
    createdAtUtc: string;
    expiresAtUtc: string;
    isRevoked: boolean;
    isCurrent: boolean;
}

export interface RevokeOtherSessionsResponse {
    revokedCount: number;
}

export interface UpdateProfileRequest {
    displayName: string;
    bio?: string;
    imageUrl?: string;
    handle?: string;
    dateOfBirth?: string;
    countryCode?: string;
    marketingOptIn?: boolean;
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

export interface PostReactionDetailDto {
    profileId: string;
    handle: string;
    displayName: string;
    bio?: string;
    imageUrl?: string;
    reactionType: string;
    reactedAtUtc: string;
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

export interface SafetyStatusDto {
    isBlocked: boolean;
    isMuted: boolean;
    isBlockedByTarget?: boolean;
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

export interface FollowedHashtagDto {
    tag: string;
    followedAtUtc: string;
}

export interface HashtagReelDto {
    id: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    caption?: string;
    thumbnailUrl?: string;
    createdAtUtc: string;
}

export interface HashtagCommunityDto {
    id: string;
    slug: string;
    name: string;
    description?: string;
    imageUrl?: string;
    isPrivate: boolean;
    memberCount: number;
}

export interface HashtagCommunityPostDto {
    id: string;
    communityId: string;
    communitySlug: string;
    communityName: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    title?: string;
    content?: string;
    createdAtUtc: string;
}

export interface HashtagBlogDto {
    id: string;
    ownerProfileId: string;
    ownerHandle: string;
    slug: string;
    title: string;
    description?: string;
    updatedAtUtc: string;
}

export interface HashtagBlogPostDto {
    id: string;
    blogId: string;
    blogSlug: string;
    authorHandle: string;
    slug: string;
    title: string;
    excerpt?: string;
    coverImageUrl?: string;
    updatedAtUtc: string;
}

export interface HashtagContentDto {
    posts: PostDto[];
    reels: HashtagReelDto[];
    communities: HashtagCommunityDto[];
    communityPosts: HashtagCommunityPostDto[];
    blogs: HashtagBlogDto[];
    blogPosts: HashtagBlogPostDto[];
}

export interface PostDto {
    id: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    imageUrl?: string;
    imageUrls?: string[];
    isSensitive?: boolean;
    createdAtUtc: string;
    likeCount: number;
    likedByMe: boolean;
    myReactionType?: string;
    reactions: ReactionSummaryDto[];
    reactionDetails: PostReactionDetailDto[];
    comments: CommentDto[];
    isDraft?: boolean;
    scheduledPublishAtUtc?: string;
    publishedAtUtc?: string;
}

export interface StoryDto {
    id: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    caption?: string;
    mediaUrl: string;
    thumbnailUrl?: string;
    isSensitive?: boolean;
    createdAtUtc: string;
    expiresAtUtc: string;
    viewedByMe: boolean;
    viewCount: number;
    isDraft?: boolean;
    scheduledPublishAtUtc?: string;
    publishedAtUtc?: string;
}

export interface StoryGroupDto {
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    hasUnseenStories: boolean;
    stories: StoryDto[];
}

export interface StoryCollectionDto {
    id: string;
    profileId: string;
    profileHandle: string;
    name: string;
    createdAtUtc: string;
    storyCount: number;
    coverMediaUrl?: string;
    stories: StoryDto[];
}

export interface StoryPlaybackProgressDto {
    authorId: string;
    storyId: string;
    lastPositionSeconds: number;
    updatedAtUtc: string;
}

export interface ReelDto {
    id: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    caption?: string;
    videoUrl: string;
    thumbnailUrl?: string;
    isSensitive?: boolean;
    durationSeconds: number;
    createdAtUtc: string;
    likeCount: number;
    likedByMe: boolean;
    viewCount?: number;
    totalWatchSeconds?: number;
    saveCount?: number;
    comments: ReelCommentDto[];
    isDraft?: boolean;
    scheduledPublishAtUtc?: string;
    publishedAtUtc?: string;
}

export interface ReelPlaybackDto {
    reelId: string;
    lastPositionSeconds: number;
    totalWatchedSeconds: number;
    isCompleted: boolean;
    lastViewedAtUtc: string;
}

export interface CreateReelAbTestRequest {
    variantATitle: string;
    variantAThumbnailUrl?: string;
    variantBTitle: string;
    variantBThumbnailUrl?: string;
}

export interface ReelAbVariantStatsDto {
    key: string;
    title: string;
    thumbnailUrl?: string;
    impressions: number;
    views: number;
    watchSeconds: number;
    averageWatchSecondsPerView: number;
    viewRatePercent: number;
}

export interface ReelAbTestDto {
    reelId: string;
    isActive: boolean;
    winningVariantKey?: string;
    createdAtUtc: string;
    updatedAtUtc: string;
    variantA: ReelAbVariantStatsDto;
    variantB: ReelAbVariantStatsDto;
}

export interface CreatorReelAnalyticsItemDto {
    reelId: string;
    caption?: string;
    createdAtUtc: string;
    views: number;
    totalWatchSeconds: number;
    averageWatchSeconds: number;
    saves: number;
    activeAbTest?: ReelAbTestDto;
}

export interface CreatorAnalyticsSummaryDto {
    days: number;
    totalViews: number;
    totalWatchSeconds: number;
    totalSaves: number;
    followerGrowth: number;
    reels: CreatorReelAnalyticsItemDto[];
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

export interface UpdateGroupConversationTitleRequest {
    title: string;
}

export interface SetConversationMuteRequest {
    isMuted: boolean;
}

export interface CreateChatMessageRequest {
    content: string;
}

export interface UpdateChatMessageRequest {
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
    isMuted: boolean;
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
    editedAtUtc?: string;
    myReactionType?: string;
    reactions: ReactionSummaryDto[];
    reactionDetails: PostReactionDetailDto[];
}

export interface CommunityMemberDto {
    profileId: string;
    handle: string;
    imageUrl?: string;
    role: string;
    joinedAtUtc: string;
    mutedUntilUtc?: string;
}

export interface CommunityRuleDto {
    text: string;
    description?: string;
}

export interface BlogThemeConfigDto {
    fontFamily?: string;
    accentColor?: string;
    backgroundColor?: string;
    surfaceColor?: string;
    headerLayout?: string;
    postListLayout?: string;
    customCss?: string;
}

export interface BlogDto {
    id: string;
    ownerProfileId: string;
    ownerHandle: string;
    slug: string;
    title: string;
    description?: string;
    isPublic: boolean;
    allowLikes: boolean;
    allowComments: boolean;
    allowShares: boolean;
    allowEmbeds: boolean;
    theme: BlogThemeConfigDto;
    createdAtUtc: string;
    updatedAtUtc: string;
    isOwner: boolean;
}

export interface BlogPostDto {
    id: string;
    blogId: string;
    blogSlug: string;
    authorProfileId: string;
    authorHandle: string;
    slug: string;
    title: string;
    content: string;
    excerpt?: string;
    coverImageUrl?: string;
    tags: string[];
    isPublished: boolean;
    createdAtUtc: string;
    updatedAtUtc: string;
    publishedAtUtc?: string;
    isOwner: boolean;
    isSavedByMe: boolean;
}

export interface CommunityDto {
    id: string;
    slug: string;
    name: string;
    description?: string;
    rules: CommunityRuleDto[];
    imageUrl?: string;
    isPrivate: boolean;
    createdByProfileId: string;
    createdByHandle: string;
    createdAtUtc: string;
    memberCount: number;
    joinedByMe: boolean;
    myRole?: string;
    members: CommunityMemberDto[];
}

export interface CommunityPollOptionDto {
    id: string;
    text: string;
    voteCount: number;
    votedByMe: boolean;
}

export interface CommunityPollDto {
    id: string;
    question: string;
    totalVotes: number;
    hasVotedByMe: boolean;
    options: CommunityPollOptionDto[];
}

export interface CommunityPostDto {
    id: string;
    communityId: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    title?: string;
    linkUrl?: string;
    content?: string;
    mediaContent?: string;
    imageUrl?: string;
    imageUrls?: string[];
    createdAtUtc: string;
    upvoteCount: number;
    downvoteCount: number;
    myVoteType?: string;
    isSavedByMe: boolean;
    poll?: CommunityPollDto;
    comments: CommunityPostCommentDto[];
}

export interface CommunityPostCommentDto {
    id: string;
    postId: string;
    parentCommentId?: string;
    authorId: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    createdAtUtc: string;
}

export interface SavedItemDto {
    id: string;
    itemType: 'Post' | 'Reel' | 'CommunityPost' | 'BlogPost';
    postId?: string;
    reelId?: string;
    communityPostId?: string;
    blogPostId?: string;
    savedAtUtc: string;
    post?: PostDto;
    reel?: ReelDto;
    communityPost?: CommunityPostDto;
    blogPost?: BlogPostDto;
}

export interface SavedCollectionDto {
    id: string;
    name: string;
    createdAtUtc: string;
    itemCount: number;
    coverThumbnailUrl?: string;
}

export interface SavedStatusDto {
    savedPostIds: Record<string, string>;   // postId → savedItemId
    savedReelIds: Record<string, string>;   // reelId → savedItemId
}
