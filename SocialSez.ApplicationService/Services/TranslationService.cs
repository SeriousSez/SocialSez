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
    private const int MaxTranslateChunkChars = 450;

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

        var cleanText = StripMarkup(text);
        if (string.IsNullOrWhiteSpace(cleanText))
            return null;

        if (cleanText.Length > MaxTranslateChars)
            cleanText = cleanText[..MaxTranslateChars];

        var chunks = SplitIntoChunks(cleanText, MaxTranslateChunkChars);
        if (chunks.Count == 0)
            return null;

        var translatedBuilder = new StringBuilder(cleanText.Length + 64);

        foreach (var chunk in chunks)
        {
            if (string.IsNullOrWhiteSpace(chunk))
                continue;

            var translatedChunk = await TranslateChunkAsync(chunk, targetCode, cancellationToken);
            if (string.IsNullOrWhiteSpace(translatedChunk))
                return null;

            translatedBuilder.Append(translatedChunk);
        }

        var translatedText = translatedBuilder.ToString().Trim();
        return string.IsNullOrWhiteSpace(translatedText) ? null : translatedText;
    }

    private static List<string> SplitIntoChunks(string text, int maxChunkChars)
    {
        var chunks = new List<string>();
        if (string.IsNullOrEmpty(text))
            return chunks;

        var index = 0;
        while (index < text.Length)
        {
            var remaining = text.Length - index;
            if (remaining <= maxChunkChars)
            {
                chunks.Add(text[index..]);
                break;
            }

            var hardEnd = index + maxChunkChars;
            var searchStart = index + (maxChunkChars / 2);

            var newlineBreak = text.LastIndexOf('\n', hardEnd - 1, hardEnd - searchStart);
            if (newlineBreak >= searchStart)
            {
                chunks.Add(text[index..(newlineBreak + 1)]);
                index = newlineBreak + 1;
                continue;
            }

            var spaceBreak = text.LastIndexOf(' ', hardEnd - 1, hardEnd - searchStart);
            if (spaceBreak >= searchStart)
            {
                chunks.Add(text[index..(spaceBreak + 1)]);
                index = spaceBreak + 1;
                continue;
            }

            chunks.Add(text[index..hardEnd]);
            index = hardEnd;
        }

        return chunks;
    }

    private static async Task<string?> TranslateChunkAsync(string chunk, string targetCode, CancellationToken cancellationToken)
    {
        var encoded = Uri.EscapeDataString(chunk);
        var url = $"get?q={encoded}&langpair=autodetect|{targetCode}";

        try
        {
            var response = await Http.GetFromJsonAsync<MyMemoryResponse>(url, cancellationToken);
            if (response?.ResponseStatus == 200 && !string.IsNullOrWhiteSpace(response.ResponseData?.TranslatedText))
                return response.ResponseData.TranslatedText;

            return null;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }

    private static string StripMarkup(string text)
    {
        // Map block-level elements to newlines so paragraph structure is preserved.
        var result = BlockElementPattern().Replace(text, "\n");
        // Strip remaining HTML tags.
        result = HtmlTagPattern().Replace(result, "");
        // Collapse horizontal whitespace (not newlines) to a single space per run.
        result = HorizontalSpacePattern().Replace(result, " ");
        // Normalise line endings.
        result = result.Replace("\r\n", "\n").Replace("\r", "\n");
        // Trim each line and remove runs of more than two consecutive blank lines.
        result = TooManyNewlinesPattern().Replace(result, "\n\n");
        return result.Trim();
    }

    [GeneratedRegex(@"<br\s*/?>|</p>|</div>|</li>|</h[1-6]>", RegexOptions.IgnoreCase)]
    private static partial Regex BlockElementPattern();

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex HtmlTagPattern();

    [GeneratedRegex(@"[^\S\n]+")]
    private static partial Regex HorizontalSpacePattern();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex TooManyNewlinesPattern();

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
