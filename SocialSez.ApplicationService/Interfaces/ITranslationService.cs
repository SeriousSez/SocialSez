namespace SocialSez.ApplicationService.Interfaces;

public interface ITranslationService
{
    Task<string?> TranslateAsync(string text, string targetLanguage, CancellationToken cancellationToken = default);
}
