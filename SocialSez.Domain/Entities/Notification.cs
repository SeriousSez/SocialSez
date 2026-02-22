namespace SocialSez.Domain.Entities;

public class Notification
{
    public Guid Id { get; set; }
    public Guid RecipientId { get; set; }
    public Guid? ActorId { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? ReferenceId { get; set; }
    public bool IsRead { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile Recipient { get; set; } = null!;
    public UserProfile? Actor { get; set; }
}
