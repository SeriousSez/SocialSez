namespace SocialSez.Domain.Entities;

public class ChatConversation
{
    public Guid Id { get; set; }
    public Guid CreatedByProfileId { get; set; }
    public bool IsGroup { get; set; }
    public string? Title { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile CreatedByProfile { get; set; } = null!;
    public ICollection<ChatConversationMember> Members { get; set; } = new List<ChatConversationMember>();
    public ICollection<ChatMessage> Messages { get; set; } = new List<ChatMessage>();
}
