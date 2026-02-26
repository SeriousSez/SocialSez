using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SocialSez.ApplicationService.Interfaces;

namespace SocialSez.API.Hubs;

[Authorize]
public class ChatHub(IChatService chatService) : Hub
{
    public const string MessageUpsertedEvent = "MessageUpserted";
    public const string TypingChangedEvent = "TypingChanged";

    public sealed record TypingChangedPayload(Guid ConversationId, Guid ProfileId, bool IsTyping);

    public async Task JoinConversation(Guid conversationId)
    {
        var profileId = GetProfileId();
        if (profileId is null)
        {
            throw new HubException("Unauthorized.");
        }

        var isMember = await chatService.IsConversationMemberAsync(profileId.Value, conversationId, Context.ConnectionAborted);
        if (!isMember)
        {
            throw new HubException("Forbidden.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, ConversationGroup(conversationId));
    }

    public Task LeaveConversation(Guid conversationId)
    {
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, ConversationGroup(conversationId));
    }

    public async Task SetTyping(Guid conversationId, bool isTyping)
    {
        var profileId = GetProfileId();
        if (profileId is null)
        {
            throw new HubException("Unauthorized.");
        }

        var isMember = await chatService.IsConversationMemberAsync(profileId.Value, conversationId, Context.ConnectionAborted);
        if (!isMember)
        {
            throw new HubException("Forbidden.");
        }

        var payload = new TypingChangedPayload(conversationId, profileId.Value, isTyping);
        await Clients.GroupExcept(ConversationGroup(conversationId), [Context.ConnectionId])
            .SendAsync(TypingChangedEvent, payload, Context.ConnectionAborted);
    }

    public static string ConversationGroup(Guid conversationId)
    {
        return $"chat:conversation:{conversationId:D}";
    }

    private Guid? GetProfileId()
    {
        var value = Context.User?.FindFirstValue("profile_id") ?? Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var profileId) ? profileId : null;
    }
}
