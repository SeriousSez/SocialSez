namespace SocialSez.Domain.Entities;

public class UserReport
{
    public Guid Id { get; set; }
    public Guid ReporterId { get; set; }
    public Guid TargetProfileId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string? Details { get; set; }
    public string Status { get; set; } = "Open";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Reporter { get; set; } = null!;
    public UserProfile TargetProfile { get; set; } = null!;
}
