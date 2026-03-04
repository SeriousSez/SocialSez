namespace SocialSez.ApplicationService.Models;

public sealed record CreateCommunityRequest(string Name, string? Description, string? ImageUrl, bool IsPrivate);

public sealed record UpdateCommunityRequest(string Name, string? Description, string? ImageUrl, bool IsPrivate);

public sealed record CreateCommunityPostRequest(
    Guid AuthorId,
    string? Content,
    string? ImageUrl,
    string? PollQuestion,
    IReadOnlyCollection<string>? PollOptions);

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

public sealed record CommunityPostDto(
    Guid Id,
    Guid CommunityId,
    Guid AuthorId,
    string AuthorHandle,
    string? AuthorImageUrl,
    string? Content,
    string? ImageUrl,
    DateTime CreatedAtUtc,
    bool IsSavedByMe,
    CommunityPollDto? Poll);

public sealed record CommunityMemberDto(
    Guid ProfileId,
    string Handle,
    string? ImageUrl,
    string Role,
    DateTime JoinedAtUtc);

public sealed record CommunityDto(
    Guid Id,
    string Slug,
    string Name,
    string? Description,
    string? ImageUrl,
    bool IsPrivate,
    Guid CreatedByProfileId,
    string CreatedByHandle,
    DateTime CreatedAtUtc,
    int MemberCount,
    bool JoinedByMe,
    string? MyRole,
    IReadOnlyCollection<CommunityMemberDto> Members);