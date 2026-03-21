using Microsoft.AspNetCore.Mvc;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Models;

namespace SocialSez.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TranslateController(ITranslationService translationService) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<TranslateResponse>> Translate(
        [FromBody] TranslateRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Text) || string.IsNullOrWhiteSpace(request.TargetLanguage))
            return BadRequest(new { message = "Text and target language are required." });

        var translated = await translationService.TranslateAsync(request.Text, request.TargetLanguage, cancellationToken);

        if (translated is null)
            return StatusCode(503, new { message = "Translation service is currently unavailable." });

        return Ok(new TranslateResponse(translated));
    }
}
