using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;
using SocialSez.API.Hubs;

namespace SocialSez.API.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class ChatController(IChatService chatService, IHubContext<ChatHub> chatHubContext) : ControllerBase
{
    [HttpGet("conversations")]
    public async Task<ActionResult<IReadOnlyCollection<ChatConversationDto>>> GetConversations(CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var conversations = await chatService.GetConversationsAsync(profileId, cancellationToken);
        return Ok(conversations);
    }

    [HttpPost("conversations/direct")]
    public async Task<ActionResult<ChatConversationDto>> CreateOrGetDirectConversation([FromBody] CreateDirectConversationRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var conversation = await chatService.CreateOrGetDirectConversationAsync(profileId, request, cancellationToken);
            return Ok(conversation);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("conversations/group")]
    public async Task<ActionResult<ChatConversationDto>> CreateGroupConversation([FromBody] CreateGroupConversationRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var conversation = await chatService.CreateGroupConversationAsync(profileId, request, cancellationToken);
            return Ok(conversation);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("conversations/{conversationId:guid}/messages")]
    public async Task<ActionResult<IReadOnlyCollection<ChatMessageDto>>> GetMessages(Guid conversationId, [FromQuery] int take = 50, [FromQuery] int skip = 0, CancellationToken cancellationToken = default)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var messages = await chatService.GetMessagesAsync(profileId, conversationId, take, skip, cancellationToken);
        return messages is null ? NotFound() : Ok(messages);
    }

    [HttpPost("conversations/{conversationId:guid}/messages")]
    public async Task<ActionResult<ChatMessageDto>> SendMessage(Guid conversationId, [FromBody] CreateChatMessageRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var message = await chatService.SendMessageAsync(profileId, conversationId, request, cancellationToken);
            if (message is not null)
            {
                await chatHubContext.Clients
                    .Group(ChatHub.ConversationGroup(message.ConversationId))
                    .SendAsync(ChatHub.MessageUpsertedEvent, message, cancellationToken);
            }

            return message is null ? NotFound() : Ok(message);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("messages/{messageId:guid}")]
    public async Task<ActionResult<ChatMessageDto>> UpdateMessage(Guid messageId, [FromBody] UpdateChatMessageRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var message = await chatService.UpdateMessageAsync(profileId, messageId, request, cancellationToken);
            if (message is not null)
            {
                await chatHubContext.Clients
                    .Group(ChatHub.ConversationGroup(message.ConversationId))
                    .SendAsync(ChatHub.MessageUpsertedEvent, message, cancellationToken);
            }

            return message is null ? NotFound() : Ok(message);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("messages/{messageId:guid}/reaction")]
    public async Task<ActionResult<ChatMessageDto>> SetMessageReaction(Guid messageId, [FromBody] SetMessageReactionRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        try
        {
            var message = await chatService.SetMessageReactionAsync(profileId, messageId, request, cancellationToken);
            if (message is not null)
            {
                await chatHubContext.Clients
                    .Group(ChatHub.ConversationGroup(message.ConversationId))
                    .SendAsync(ChatHub.MessageUpsertedEvent, message, cancellationToken);
            }

            return message is null ? NotFound() : Ok(message);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("messages/{messageId:guid}/reaction")]
    public async Task<ActionResult<ChatMessageDto>> ClearMessageReaction(Guid messageId, CancellationToken cancellationToken)
    {
        if (!TryGetProfileId(out var profileId))
        {
            return Unauthorized();
        }

        var message = await chatService.ClearMessageReactionAsync(profileId, messageId, cancellationToken);
        if (message is not null)
        {
            await chatHubContext.Clients
                .Group(ChatHub.ConversationGroup(message.ConversationId))
                .SendAsync(ChatHub.MessageUpsertedEvent, message, cancellationToken);
        }

        return message is null ? NotFound() : Ok(message);
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var profileIdClaim = User.FindFirstValue("profile_id") ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(profileIdClaim, out profileId);
    }
}
