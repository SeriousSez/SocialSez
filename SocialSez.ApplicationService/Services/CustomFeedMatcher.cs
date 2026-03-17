using System.Text.RegularExpressions;

namespace SocialSez.ApplicationService.Services;

internal static class CustomFeedMatcher
{
    private const int MaxRuleCount = 20;
    private static readonly Regex HashtagRegex = new(@"(?<![\p{L}\p{N}_-])#(?<tag>[\p{L}\p{N}_-]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static string NormalizeHandle(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        var isExcluded = trimmed.StartsWith('!');
        var withoutExcludePrefix = isExcluded ? trimmed[1..] : trimmed;
        var normalized = withoutExcludePrefix.TrimStart('@').Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return string.Empty;
        }

        return isExcluded ? $"!{normalized}" : normalized;
    }

    public static string NormalizeAuthorHandle(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.TrimStart('@', '!').Trim().ToLowerInvariant();
    }

    public static string NormalizeHashtag(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.TrimStart('#').Trim().ToLowerInvariant();
    }

    public static string[] NormalizeHandles(IEnumerable<string>? values)
        => values?
            .Select(NormalizeHandle)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .Take(MaxRuleCount)
            .ToArray()
        ?? [];

    public static (HashSet<string> IncludedHandles, HashSet<string> ExcludedHandles) SplitHandleRules(IEnumerable<string>? values)
    {
        var included = new HashSet<string>(StringComparer.Ordinal);
        var excluded = new HashSet<string>(StringComparer.Ordinal);

        foreach (var value in NormalizeHandles(values))
        {
            if (value.StartsWith('!'))
            {
                var normalized = value[1..];
                if (!string.IsNullOrWhiteSpace(normalized))
                {
                    excluded.Add(normalized);
                }

                continue;
            }

            included.Add(value);
        }

        return (included, excluded);
    }

    public static string[] NormalizeHashtags(IEnumerable<string>? values)
        => values?
            .Select(NormalizeHashtag)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .Take(MaxRuleCount)
            .ToArray()
        ?? [];

    public static string[] ExtractHashtags(string? text)
        => string.IsNullOrWhiteSpace(text)
            ? []
            : HashtagRegex.Matches(text)
                .Select(match => NormalizeHashtag(match.Groups["tag"].Value))
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Distinct(StringComparer.Ordinal)
                .ToArray();

    public static bool Matches(string? authorHandle, string? text, ISet<string> includedAuthorHandles, ISet<string> excludedAuthorHandles, ISet<string> hashtags)
    {
        var normalizedHandle = NormalizeAuthorHandle(authorHandle);
        if (!string.IsNullOrWhiteSpace(normalizedHandle) && excludedAuthorHandles.Contains(normalizedHandle))
        {
            return false;
        }

        if (includedAuthorHandles.Count == 0 && hashtags.Count == 0)
        {
            return true;
        }

        if (!string.IsNullOrWhiteSpace(normalizedHandle) && includedAuthorHandles.Contains(normalizedHandle))
        {
            return true;
        }

        if (hashtags.Count == 0)
        {
            return false;
        }

        return ExtractHashtags(text).Any(hashtags.Contains);
    }
}