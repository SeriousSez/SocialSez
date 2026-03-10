namespace SocialSez.Domain.Entities;

public class ChatConversationMember
{
    public Guid ConversationId { get; set; }
    public Guid ProfileId { get; set; }
    public bool IsMuted { get; set; }
    public DateTime JoinedAtUtc { get; set; } = DateTime.UtcNow;

    public ChatConversation Conversation { get; set; } = null!;
    public UserProfile Profile { get; set; } = null!;
}
