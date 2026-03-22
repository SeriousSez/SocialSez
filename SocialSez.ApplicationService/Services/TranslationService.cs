using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Net.Http.Json;
using SocialSez.ApplicationService.Interfaces;

namespace SocialSez.ApplicationService.Services;

public partial class TranslationService : ITranslationService
{
    private const int MaxTranslateChars = 4500;
    private const int MaxTranslateChunkChars = 450;
    private const string NewlineToken = "\uE000SSZNL\uE001";
    private const char HtmlTagTokenStart = '\uE002';
    private const char HtmlTagTokenEnd = '\uE003';

    // One shared client per process – avoids socket exhaustion for a simple proxy.
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2)
    })
    {
        BaseAddress = new Uri("https://api.mymemory.translated.net/"),
        Timeout = TimeSpan.FromSeconds(20)
    };

    private static readonly HttpClient GoogleHttp = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2)
    })
    {
        BaseAddress = new Uri("https://translate.googleapis.com/"),
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

        if (!TryResolveTargetCode(targetLanguage, out var targetCode))
            return null;

        var protectedText = ProtectHtmlTags(text, out var preservedTags);
        var (translatedProtected, _) = await TranslateTextSegmentAsync(protectedText, targetCode, cancellationToken, MaxTranslateChars);
        if (!string.IsNullOrWhiteSpace(translatedProtected))
        {
            var restored = RestoreHtmlTags(translatedProtected, preservedTags, out var hasUnrestoredTokens);
            if (!hasUnrestoredTokens)
            {
                var translatedText = NormalizeTranslationArtifacts(restored.Trim(), targetCode);
                return string.IsNullOrWhiteSpace(translatedText) ? null : translatedText;
            }
        }

        return await TranslateByHtmlSegmentsAsync(text, targetCode, cancellationToken);
    }

    private async Task<string?> TranslateByHtmlSegmentsAsync(string text, string targetCode, CancellationToken cancellationToken)
    {

        var translatedBuilder = new StringBuilder(text.Length + 64);
        var remainingChars = MaxTranslateChars;
        var cursor = 0;

        foreach (Match tagMatch in HtmlTagPattern().Matches(text))
        {
            if (tagMatch.Index > cursor)
            {
                var segment = text[cursor..tagMatch.Index];
                var (translatedSegment, consumedChars) = await TranslateTextSegmentAsync(segment, targetCode, cancellationToken, remainingChars);
                remainingChars = Math.Max(0, remainingChars - consumedChars);
                translatedBuilder.Append(translatedSegment);
            }

            translatedBuilder.Append(tagMatch.Value);
            cursor = tagMatch.Index + tagMatch.Length;
        }

        if (cursor < text.Length)
        {
            var tailSegment = text[cursor..];
            var (translatedTail, consumedChars) = await TranslateTextSegmentAsync(tailSegment, targetCode, cancellationToken, remainingChars);
            remainingChars = Math.Max(0, remainingChars - consumedChars);
            translatedBuilder.Append(translatedTail);
        }

        var translatedText = NormalizeTranslationArtifacts(translatedBuilder.ToString().Trim(), targetCode);
        return string.IsNullOrWhiteSpace(translatedText) ? null : translatedText;
    }

    private static async Task<(string TranslatedText, int ConsumedChars)> TranslateTextSegmentAsync(string textSegment, string targetCode, CancellationToken cancellationToken, int remainingChars)
    {
        if (string.IsNullOrEmpty(textSegment))
            return (textSegment, 0);

        if (remainingChars <= 0 || string.IsNullOrWhiteSpace(textSegment))
            return (textSegment, 0);

        var translatableLength = Math.Min(textSegment.Length, remainingChars);
        var translatableSegment = textSegment[..translatableLength];
        var nonTranslatedRemainder = textSegment.Length > translatableLength ? textSegment[translatableLength..] : string.Empty;

        var protectedLineBreaks = ProtectLineBreaks(translatableSegment);
        var chunks = SplitIntoChunks(protectedLineBreaks, MaxTranslateChunkChars);
        if (chunks.Count == 0)
            return (textSegment, 0);

        var translatedBuilder = new StringBuilder(protectedLineBreaks.Length + 32);
        foreach (var chunk in chunks)
        {
            if (string.IsNullOrWhiteSpace(chunk))
            {
                translatedBuilder.Append(chunk);
                continue;
            }

            var translatedChunk = await TranslateChunkAsync(chunk, targetCode, cancellationToken);
            if (string.IsNullOrWhiteSpace(translatedChunk))
                return (textSegment, 0);

            translatedBuilder.Append(translatedChunk);
        }

        var restored = RestoreLineBreaks(translatedBuilder.ToString());
        return (restored + nonTranslatedRemainder, translatableLength);
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
        var translatedViaGoogle = await TranslateChunkViaGoogleAsync(chunk, targetCode, cancellationToken);
        if (!string.IsNullOrWhiteSpace(translatedViaGoogle))
            return translatedViaGoogle;

        return await TranslateChunkViaMyMemoryAsync(chunk, targetCode, cancellationToken);
    }

    private static async Task<string?> TranslateChunkViaMyMemoryAsync(string chunk, string targetCode, CancellationToken cancellationToken)
    {
        var encoded = Uri.EscapeDataString(chunk);
        var url = $"get?q={encoded}&langpair=autodetect|{targetCode}";

        try
        {
            using var response = await Http.GetAsync(url, cancellationToken);
            var payload = await response.Content.ReadFromJsonAsync<MyMemoryResponse>(cancellationToken: cancellationToken);

            var translated = payload?.ResponseData?.TranslatedText;
            if (string.IsNullOrWhiteSpace(translated))
                return null;

            if (payload?.ResponseStatus == 429 || IsMyMemoryWarning(translated))
                return null;

            return translated;
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

    private static async Task<string?> TranslateChunkViaGoogleAsync(string chunk, string targetCode, CancellationToken cancellationToken)
    {
        var encodedText = Uri.EscapeDataString(chunk);
        var encodedTarget = Uri.EscapeDataString(targetCode);
        var url = $"translate_a/single?client=gtx&sl=auto&tl={encodedTarget}&dt=t&q={encodedText}";

        try
        {
            using var response = await GoogleHttp.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

            if (doc.RootElement.ValueKind != JsonValueKind.Array || doc.RootElement.GetArrayLength() == 0)
                return null;

            var segments = doc.RootElement[0];
            if (segments.ValueKind != JsonValueKind.Array)
                return null;

            var translatedBuilder = new StringBuilder(chunk.Length + 16);
            foreach (var segment in segments.EnumerateArray())
            {
                if (segment.ValueKind != JsonValueKind.Array || segment.GetArrayLength() == 0)
                    continue;

                var part = segment[0].GetString();
                if (!string.IsNullOrEmpty(part))
                    translatedBuilder.Append(part);
            }

            var translated = translatedBuilder.ToString();
            return string.IsNullOrWhiteSpace(translated) ? null : translated;
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

    private static string ProtectLineBreaks(string value)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        return value
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace("\r", "\n", StringComparison.Ordinal)
            .Replace("\n", NewlineToken, StringComparison.Ordinal);
    }

    private static string RestoreLineBreaks(string value)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        return value.Replace(NewlineToken, "\n", StringComparison.Ordinal);
    }

    private static string ProtectHtmlTags(string value, out List<string> preservedTags)
    {
        preservedTags = [];
        if (string.IsNullOrEmpty(value))
            return value;

        var protectedBuilder = new StringBuilder(value.Length + 32);
        var cursor = 0;

        foreach (Match tagMatch in HtmlTagPattern().Matches(value))
        {
            if (tagMatch.Index > cursor)
                protectedBuilder.Append(value[cursor..tagMatch.Index]);

            preservedTags.Add(tagMatch.Value);
            protectedBuilder.Append(BuildHtmlTagToken(preservedTags.Count - 1));
            cursor = tagMatch.Index + tagMatch.Length;
        }

        if (cursor < value.Length)
            protectedBuilder.Append(value[cursor..]);

        return protectedBuilder.ToString();
    }

    private static string RestoreHtmlTags(string value, IReadOnlyList<string> preservedTags, out bool hasUnrestoredTokens)
    {
        if (string.IsNullOrEmpty(value) || preservedTags.Count == 0)
        {
            hasUnrestoredTokens = false;
            return value;
        }

        var restored = value;
        for (var index = 0; index < preservedTags.Count; index++)
        {
            restored = restored.Replace(
                BuildHtmlTagToken(index),
                preservedTags[index],
                StringComparison.Ordinal);
        }

        hasUnrestoredTokens = restored.IndexOf(HtmlTagTokenStart) >= 0 || restored.IndexOf(HtmlTagTokenEnd) >= 0;
        return restored;
    }

    private static string BuildHtmlTagToken(int index)
        => string.Concat(HtmlTagTokenStart, index.ToString(), HtmlTagTokenEnd);

    private static bool IsMyMemoryWarning(string text)
        => text.StartsWith("MYMEMORY WARNING", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeTranslationArtifacts(string text, string targetCode)
    {
        if (string.IsNullOrWhiteSpace(text))
            return text;

        if (string.Equals(targetCode, "da", StringComparison.OrdinalIgnoreCase))
            return DanishLinkKlPattern().Replace(text, "hos");

        return text;
    }

    private static bool TryResolveTargetCode(string targetLanguage, out string targetCode)
    {
        var normalized = targetLanguage.Trim();
        if (LangMap.TryGetValue(normalized, out targetCode!))
            return true;

        var hyphenIndex = normalized.IndexOf('-');
        if (hyphenIndex > 0 && LangMap.TryGetValue(normalized[..hyphenIndex], out targetCode!))
            return true;

        var underscoreIndex = normalized.IndexOf('_');
        if (underscoreIndex > 0 && LangMap.TryGetValue(normalized[..underscoreIndex], out targetCode!))
            return true;

        targetCode = string.Empty;
        return false;
    }

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex HtmlTagPattern();

    [GeneratedRegex(@"\bkl(?=\s*<a\b)", RegexOptions.IgnoreCase)]
    private static partial Regex DanishLinkKlPattern();

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
