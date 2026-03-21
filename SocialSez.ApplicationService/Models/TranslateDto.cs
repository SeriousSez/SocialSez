namespace SocialSez.ApplicationService.Models;

public record TranslateRequest(string Text, string TargetLanguage);
public record TranslateResponse(string TranslatedText);
