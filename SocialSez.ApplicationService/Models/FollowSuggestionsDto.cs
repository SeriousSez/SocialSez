namespace SocialSez.ApplicationService.Models;

public sealed record FollowSuggestionsDto(
    IReadOnlyCollection<ProfileDto> Following,
    IReadOnlyCollection<ProfileDto> Relevant);
