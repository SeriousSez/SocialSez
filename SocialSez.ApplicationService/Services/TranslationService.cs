using System.Net.Sockets;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Net.Http.Json;
using SocialSez.ApplicationService.Interfaces;

namespace SocialSez.ApplicationService.Services;

public partial class TranslationService : ITranslationService
{
    private const int MaxTranslateChars = 4500;

    // One shared client per process – avoids socket exhaustion for a simple proxy.
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2)
    })
    {
        BaseAddress = new Uri("https://api.mymemory.translated.net/"),
        Timeout = TimeSpan.FromSeconds(20)
    };

    private static readonly Dictionary<string, string> LangMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = "en",
        ["en-us"] = "en",
        ["en-gb"] = "en-GB",
        ["da"] = "da",
        ["de"] = "de",
        ["fr"] = "fr",
        ["es"] = "es",
        ["it"] = "it",
        ["nl"] = "nl",
        ["nb"] = "no",
        ["no"] = "no",
        ["pl"] = "pl",
        ["pt-br"] = "pt-BR",
        ["sv"] = "sv",
        ["tr"] = "tr",
        ["ar"] = "ar",
    };

    public async Task<string?> TranslateAsync(string text, string targetLanguage, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text) || string.IsNullOrWhiteSpace(targetLanguage))
            return null;

        if (!LangMap.TryGetValue(targetLanguage, out var targetCode))
            return null;

        // Strip HTML and markdown formatting so the translation API receives clean prose.
        var cleanText = StripMarkup(text);
        if (string.IsNullOrWhiteSpace(cleanText))
            return null;

        // Enforce character limit.
        if (cleanText.Length > MaxTranslateChars)
            cleanText = cleanText[..MaxTranslateChars];

        var encoded = Uri.EscapeDataString(cleanText);
        var url = $"get?q={encoded}&langpair=autodetect|{targetCode}";

        try
        {
            var response = await Http.GetFromJsonAsync<MyMemoryResponse>(url, cancellationToken);
            if (response?.ResponseStatus == 200 && !string.IsNullOrWhiteSpace(response.ResponseData?.TranslatedText))
                return response.ResponseData.TranslatedText;

            return null;
        }
        catch (OperationCanceledException) { throw; }
        catch
        {
            return null;
        }
    }

    private static string StripMarkup(string text)
    {
        // Strip HTML tags.
        var result = HtmlTagPattern().Replace(text, " ");
        // Collapse whitespace.
        result = WhitespacePattern().Replace(result, " ").Trim();
        return result;
    }

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex HtmlTagPattern();

    [GeneratedRegex(@"\s{2,}")]
    private static partial Regex WhitespacePattern();

    private sealed class MyMemoryResponse
    {
        [JsonPropertyName("responseStatus")]
        public int ResponseStatus { get; set; }

        [JsonPropertyName("responseData")]
        public MyMemoryData? ResponseData { get; set; }
    }

    private sealed class MyMemoryData
    {
        [JsonPropertyName("translatedText")]
        public string? TranslatedText { get; set; }
    }
}
