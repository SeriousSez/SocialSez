namespace SocialSez.ApplicationService.Models;

public static class FollowActionStatuses
{
    public const string Followed = "Followed";
    public const string RequestPending = "RequestPending";
    public const string AlreadyFollowing = "AlreadyFollowing";
    public const string AlreadyRequested = "AlreadyRequested";
    public const string Invalid = "Invalid";
}

public sealed record FollowActionResultDto(string Status);

public sealed record FollowRequestDto(
    Guid FollowerId,
    string FollowerHandle,
    string? FollowerImageUrl,
    DateTime CreatedAtUtc,
    string Status);

public sealed record FollowStatusDto(bool IsFollowing, bool IsRequested, bool RequiresApproval);
