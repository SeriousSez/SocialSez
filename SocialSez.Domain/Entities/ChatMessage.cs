namespace SocialSez.Domain.Entities;

public class ChatMessage
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid AuthorProfileId { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? EditedAtUtc { get; set; }

    public ChatConversation Conversation { get; set; } = null!;
    public UserProfile AuthorProfile { get; set; } = null!;
    public ICollection<ChatMessageReaction> Reactions { get; set; } = new List<ChatMessageReaction>();
}
