namespace SocialSez.ApplicationService.Models;

public sealed record SafetyStatusDto(bool IsBlocked, bool IsMuted, bool IsBlockedByTarget);

public sealed record ReportProfileRequestDto(string Reason, string? Details);
