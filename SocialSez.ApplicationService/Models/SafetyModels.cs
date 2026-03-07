namespace SocialSez.ApplicationService.Models;

public sealed record SafetyStatusDto(bool IsBlocked, bool IsMuted, bool IsBlockedByTarget);

public sealed record ReportProfileRequestDto(string Reason, string? Details);

public sealed record ReportContentRequestDto(string Reason, string? Details);

public sealed record ReputationScoreDto(
    Guid ProfileId,
    int Score,
    string RiskLevel,
    int ReportsOpen,
    int BlocksReceived,
    int QueueItemsOpen,
    DateTime CalculatedAtUtc);

public sealed record ContentModerationScanRequestDto(
    string? Content,
    string? LinkUrl,
    Guid? CommunityId,
    Guid? SourceEntityId,
    string? SourceType);

public sealed record ContentModerationScanResultDto(
    bool ShouldQueue,
    bool IsThrottled,
    int RecommendedRetryAfterSeconds,
    int SpamScore,
    int LinkRiskScore,
    int RiskScore,
    string? MatchedKeyword,
    Guid? QueueItemId,
    string RulePreset);

public sealed record CommunityModerationSettingsDto(
    Guid CommunityId,
    string RulePreset,
    bool AutoModerationEnabled,
    int SpamThreshold,
    int LinkRiskThreshold,
    IReadOnlyCollection<string> KeywordFilters,
    DateTime UpdatedAtUtc);

public sealed record UpdateCommunityModerationSettingsRequestDto(
    string RulePreset,
    bool AutoModerationEnabled,
    int SpamThreshold,
    int LinkRiskThreshold,
    IReadOnlyCollection<string>? KeywordFilters);

public sealed record CommunityShadowMuteDto(
    Guid CommunityId,
    Guid ProfileId,
    string Handle,
    string? Reason,
    DateTime CreatedAtUtc,
    DateTime? ExpiresAtUtc,
    Guid CreatedByProfileId,
    string CreatedByHandle);

public sealed record CreateCommunityShadowMuteRequestDto(
    Guid TargetProfileId,
    string? Reason,
    DateTime? ExpiresAtUtc);

public sealed record CommunityBanAppealDto(
    Guid Id,
    Guid CommunityId,
    Guid ProfileId,
    string Handle,
    string Reason,
    string Status,
    string? ResolutionNote,
    Guid? ReviewedByProfileId,
    string? ReviewedByHandle,
    DateTime CreatedAtUtc,
    DateTime? ReviewedAtUtc);

public sealed record CreateCommunityBanAppealRequestDto(string Reason);

public sealed record ResolveCommunityBanAppealRequestDto(bool Approved, string? ResolutionNote);

public sealed record ModerationQueueItemDto(
    Guid Id,
    Guid? CommunityId,
    Guid? ReporterId,
    string? ReporterHandle,
    Guid? TargetProfileId,
    string? TargetProfileHandle,
    Guid? SourceEntityId,
    string SourceType,
    string TriggerType,
    int SpamScore,
    int LinkRiskScore,
    int RiskScore,
    string? LinkUrl,
    string? MatchedKeyword,
    string? ContentSnippet,
    string Status,
    string? Resolution,
    string? ResolutionNote,
    Guid? ReviewedByProfileId,
    string? ReviewedByHandle,
    DateTime CreatedAtUtc,
    DateTime? ReviewedAtUtc);

public sealed record ResolveModerationQueueItemRequestDto(string Resolution, string? ResolutionNote);
