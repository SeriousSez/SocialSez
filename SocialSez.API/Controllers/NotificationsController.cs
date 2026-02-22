using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NotificationsController(INotificationService notificationService) : ControllerBase
{
    [Authorize]
    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<NotificationDto>>> Get([FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var notifications = await notificationService.GetForRecipientAsync(profileId, take, cancellationToken);
        return Ok(notifications);
    }

    [Authorize]
    [HttpPost("{notificationId:guid}/read")]
    public async Task<ActionResult> MarkRead(Guid notificationId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var success = await notificationService.MarkReadAsync(notificationId, profileId, cancellationToken);
        return success ? NoContent() : NotFound();
    }

    [Authorize]
    [HttpPost("read-all")]
    public async Task<ActionResult<MarkAllReadResponse>> MarkAllRead(CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var count = await notificationService.MarkAllReadAsync(profileId, cancellationToken);
        return Ok(new MarkAllReadResponse(count));
    }

    public sealed record MarkAllReadResponse(int UpdatedCount);

    private bool TryGetProfileId(out Guid profileId)
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        return Guid.TryParse(raw, out profileId);
    }
}
