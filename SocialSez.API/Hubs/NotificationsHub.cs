using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace SocialSez.API.Hubs;

[Authorize]
public class NotificationsHub : Hub
{
    public const string NotificationCreatedEvent = "NotificationCreated";

    public override async Task OnConnectedAsync()
    {
        var profileId = GetProfileId();
        if (profileId is null)
        {
            throw new HubException("Unauthorized.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, RecipientGroup(profileId.Value));
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var profileId = GetProfileId();
        if (profileId is not null)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, RecipientGroup(profileId.Value));
        }

        await base.OnDisconnectedAsync(exception);
    }

    public static string RecipientGroup(Guid recipientId)
    {
        return $"notifications:recipient:{recipientId:D}";
    }

    private Guid? GetProfileId()
    {
        var value = Context.User?.FindFirstValue("profile_id")
            ?? Context.User?.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? Context.User?.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? Context.User?.FindFirstValue("sub");
        return Guid.TryParse(value, out var profileId) ? profileId : null;
    }
}