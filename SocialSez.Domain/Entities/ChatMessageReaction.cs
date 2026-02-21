namespace SocialSez.Domain.Entities;

public class ChatMessageReaction
{
    public Guid MessageId { get; set; }
    public Guid ProfileId { get; set; }
    public string Type { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ChatMessage Message { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}
