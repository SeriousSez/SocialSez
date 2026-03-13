using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/collections")]
[Authorize]
public class CollectionsController(ISavedCollectionService savedCollectionService) : ControllerBase
{
    // GET /api/collections/items?take=50&skip=0
    [HttpGet("items")]
    public async Task<ActionResult<IReadOnlyList<SavedItemDto>>> GetAllSaved([FromQuery] int take = 50, [FromQuery] int skip = 0)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        var items = await savedCollectionService.GetAllSavedItemsAsync(profileId, Math.Clamp(take, 1, 100), Math.Max(skip, 0));
        return Ok(items);
    }

    // GET /api/collections
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<SavedCollectionDto>>> GetCollections()
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        var collections = await savedCollectionService.GetCollectionsAsync(profileId);
        return Ok(collections);
    }

    // POST /api/collections
    [HttpPost]
    public async Task<ActionResult<SavedCollectionDto>> CreateCollection([FromBody] CreateCollectionRequest request)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest("Name is required.");
        var collection = await savedCollectionService.CreateCollectionAsync(profileId, request.Name);
        return Created($"api/collections/{collection.Id}", collection);
    }

    // DELETE /api/collections/{id}
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteCollection(Guid id)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        await savedCollectionService.DeleteCollectionAsync(profileId, id);
        return NoContent();
    }

    // PATCH /api/collections/{id}
    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<SavedCollectionDto>> RenameCollection(Guid id, [FromBody] RenameCollectionRequest request)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest("Name is required.");
        try
        {
            var collection = await savedCollectionService.RenameCollectionAsync(profileId, id, request.Name);
            return Ok(collection);
        }
        catch (InvalidOperationException)
        {
            return NotFound();
        }
    }

    // GET /api/collections/{id}/items?take=50&skip=0
    [HttpGet("{id:guid}/items")]
    public async Task<ActionResult<IReadOnlyList<SavedItemDto>>> GetCollectionItems(Guid id, [FromQuery] int take = 50, [FromQuery] int skip = 0)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        var items = await savedCollectionService.GetCollectionItemsAsync(profileId, id, Math.Clamp(take, 1, 100), Math.Max(skip, 0));
        return Ok(items);
    }

    // POST /api/collections/items/posts/{postId}
    [HttpPost("items/posts/{postId:guid}")]
    public async Task<ActionResult<SavedItemDto>> SavePost(Guid postId)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        try
        {
            var item = await savedCollectionService.SavePostAsync(profileId, postId);
            return Ok(item);
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    // POST /api/collections/items/reels/{reelId}
    [HttpPost("items/reels/{reelId:guid}")]
    public async Task<ActionResult<SavedItemDto>> SaveReel(Guid reelId)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        try
        {
            var item = await savedCollectionService.SaveReelAsync(profileId, reelId);
            return Ok(item);
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    // POST /api/collections/items/community-posts/{postId}
    [HttpPost("items/community-posts/{postId:guid}")]
    public async Task<ActionResult<SavedItemDto>> SaveCommunityPost(Guid postId)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        try
        {
            var item = await savedCollectionService.SaveCommunityPostAsync(profileId, postId);
            return Ok(item);
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    // POST /api/collections/items/blog-posts/{postId}
    [HttpPost("items/blog-posts/{postId:guid}")]
    public async Task<ActionResult<SavedItemDto>> SaveBlogPost(Guid postId)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        try
        {
            var item = await savedCollectionService.SaveBlogPostAsync(profileId, postId);
            return Ok(item);
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    // DELETE /api/collections/items/{savedItemId}
    [HttpDelete("items/{savedItemId:guid}")]
    public async Task<IActionResult> UnsaveItem(Guid savedItemId)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        await savedCollectionService.UnsaveItemAsync(profileId, savedItemId);
        return NoContent();
    }

    // POST /api/collections/{id}/items/{savedItemId}
    [HttpPost("{id:guid}/items/{savedItemId:guid}")]
    public async Task<IActionResult> AddToCollection(Guid id, Guid savedItemId)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        try
        {
            await savedCollectionService.AddToCollectionAsync(profileId, savedItemId, id);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    // DELETE /api/collections/{id}/items/{savedItemId}
    [HttpDelete("{id:guid}/items/{savedItemId:guid}")]
    public async Task<IActionResult> RemoveFromCollection(Guid id, Guid savedItemId)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();
        await savedCollectionService.RemoveFromCollectionAsync(profileId, savedItemId, id);
        return NoContent();
    }

    // GET /api/collections/status?postIds=...&reelIds=...
    [HttpGet("status")]
    public async Task<ActionResult<SavedStatusDto>> GetSavedStatus([FromQuery] string? postIds, [FromQuery] string? reelIds)
    {
        if (!TryGetProfileId(out var profileId)) return Unauthorized();

        var parsedPostIds = ParseGuids(postIds);
        var parsedReelIds = ParseGuids(reelIds);

        var status = await savedCollectionService.GetSavedStatusAsync(profileId, parsedPostIds, parsedReelIds);
        return Ok(status);
    }

    private bool TryGetProfileId(out Guid profileId)
    {
        var claim = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");
        return Guid.TryParse(claim, out profileId);
    }

    private static List<Guid> ParseGuids(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        var result = new List<Guid>();
        foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (Guid.TryParse(part, out var g))
                result.Add(g);
        }
        return result;
    }
}
