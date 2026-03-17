namespace SocialSez.ApplicationService.Models;

public sealed record CustomFeedDto(
    Guid Id,
    string Name,
    IReadOnlyCollection<string> AuthorHandles,
    IReadOnlyCollection<string> Hashtags,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc);

public sealed record CreateCustomFeedRequest(
    string Name,
    IReadOnlyCollection<string>? AuthorHandles,
    IReadOnlyCollection<string>? Hashtags);

public sealed record UpdateCustomFeedRequest(
    string Name,
    IReadOnlyCollection<string>? AuthorHandles,
    IReadOnlyCollection<string>? Hashtags);