namespace SocialSez.ApplicationService.Models;

public sealed record CreateCommunityRequest(string Name, string? Description, IReadOnlyCollection<CommunityRuleDto>? Rules, string? ImageUrl, bool IsPrivate);

public sealed record UpdateCommunityRequest(string Name, string? Description, IReadOnlyCollection<CommunityRuleDto>? Rules, string? ImageUrl, bool IsPrivate);

public sealed record UpdateCommunityMemberRoleRequest(string Role);

public sealed record TimeoutCommunityMemberRequest(int DurationDays);

public sealed record CommunityRuleDto(
    string Text,
    string? Description);

public sealed record CreateCommunityPostRequest(
    Guid AuthorId,
    string? Title,
    string? LinkUrl,
    string? Content,
    IReadOnlyCollection<string>? ImageUrls,
    string? PollQuestion,
    IReadOnlyCollection<string>? PollOptions);

public sealed record UpdateCommunityPostRequest(
    Guid ActorId,
    string? Title,
    string? LinkUrl,
    string? Content,
    IReadOnlyCollection<string>? ImageUrls,
    string? PollQuestion,
    IReadOnlyCollection<string>? PollOptions,
    bool ClearPoll);

public sealed record CreateCommunityPostCommentRequest(
    Guid AuthorId,
    string Content,
    Guid? ParentCommentId = null);

public sealed record UpdateCommunityPostCommentRequest(
    Guid ActorId,
    string Content);

public sealed record VoteCommunityPostRequest(
    Guid VoterId,
    string? VoteType);

public sealed record VoteCommunityPollRequest(Guid VoterId, Guid OptionId);

public sealed record CommunityPollOptionDto(
    Guid Id,
    string Text,
    int VoteCount,
    bool VotedByMe);

public sealed record CommunityPollDto(
    Guid Id,
    string Question,
    int TotalVotes,
    bool HasVotedByMe,
    IReadOnlyCollection<CommunityPollOptionDto> Options);

public sealed record CommunityPostCommentDto(
    Guid Id,
    Guid PostId,
    Guid? ParentCommentId,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string Content,
    DateTime CreatedAtUtc);

public sealed record CommunityPostDto(
    Guid Id,
    Guid CommunityId,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Title,
    string? LinkUrl,
    string? Content,
    string? ImageUrl,
    IReadOnlyCollection<string> ImageUrls,
    DateTime CreatedAtUtc,
    int UpvoteCount,
    int DownvoteCount,
    string? MyVoteType,
    bool IsSavedByMe,
    CommunityPollDto? Poll,
    IReadOnlyCollection<CommunityPostCommentDto> Comments);

public sealed record CommunityMemberDto(
    Guid ProfileId,
    string Handle,
    string? ImageUrl,
    string Role,
    DateTime JoinedAtUtc,
    DateTime? MutedUntilUtc);

public sealed record CommunityDto(
    Guid Id,
    string Slug,
    string Name,
    string? Description,
    IReadOnlyCollection<CommunityRuleDto> Rules,
    string? ImageUrl,
    bool IsPrivate,
    Guid CreatedByProfileId,
    string CreatedByHandle,
    DateTime CreatedAtUtc,
    int MemberCount,
    bool JoinedByMe,
    string? MyRole,
    IReadOnlyCollection<CommunityMemberDto> Members);