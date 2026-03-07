using System.Text.RegularExpressions;

namespace SocialSez.ApplicationService.Services;

internal static partial class DiscoverySearchBackend
{
    private static readonly IReadOnlyList<DiscoveryTopic> Topics =
    [
        new("startup", ["startups", "founder", "founders", "launch"]),
        new("build-in-public", ["building-in-public", "buildinpublic", "bip", "devlog"]),
        new("saas", ["software", "product", "products"]),
        new("ai", ["ml", "machine-learning", "llm"]),
        new("community", ["communities", "social", "network"]),
        new("webdev", ["frontend", "backend", "fullstack", "javascript", "typescript"]),
        new("mobile", ["android", "ios", "flutter", "react-native"]),
        new("security", ["privacy", "safety"]),
        new("productivity", ["workflow", "automation"]),
        new("creator", ["creators", "content", "blogging"])
    ];

    private static readonly Dictionary<string, string> AliasToCanonical = BuildAliasIndex();

    public static string? NormalizeQuery(string? query, int maxLength = 120)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return null;
        }

        var normalized = query.Trim();
        return normalized.Length > maxLength
            ? normalized[..maxLength].Trim()
            : normalized;
    }

    public static IReadOnlyList<string> ExpandTerms(string? query)
    {
        var normalized = NormalizeTerm(query);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return [];
        }

        if (normalized.Length < 2)
        {
            return [];
        }

        var terms = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            normalized
        };

        var canonical = Canonicalize(normalized);
        terms.Add(canonical);

        if (canonical.EndsWith('s') && canonical.Length > 3)
        {
            terms.Add(canonical[..^1]);
        }
        else if (canonical.Length > 2)
        {
            terms.Add($"{canonical}s");
        }

        // Avoid broad alias-topic fan-out for 2-character queries.
        if (normalized.Length >= 3)
        {
            foreach (var topic in Topics)
            {
                var all = topic.AllTerms;
                if (!all.Any(term => term.Contains(normalized, StringComparison.OrdinalIgnoreCase) || normalized.Contains(term, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                foreach (var term in all)
                {
                    terms.Add(term);
                }
            }
        }

        return terms.Where(term => !string.IsNullOrWhiteSpace(term)).ToArray();
    }

    public static double ScoreText(string? value, IReadOnlyList<string> expandedTerms)
    {
        var normalized = NormalizeTerm(value);
        if (string.IsNullOrWhiteSpace(normalized) || expandedTerms.Count == 0)
        {
            return 0;
        }

        var tokens = SplitTokens(normalized);
        var best = 0d;

        foreach (var term in expandedTerms)
        {
            if (string.IsNullOrWhiteSpace(term))
            {
                continue;
            }

            var shortTerm = term.Length <= 2;
            var mediumTerm = term.Length == 3;

            if (string.Equals(normalized, term, StringComparison.OrdinalIgnoreCase))
            {
                best = Math.Max(best, 120);
                continue;
            }

            if (normalized.StartsWith(term, StringComparison.OrdinalIgnoreCase))
            {
                best = Math.Max(best, 80);
            }

            if (!shortTerm && !mediumTerm && normalized.Contains(term, StringComparison.OrdinalIgnoreCase))
            {
                best = Math.Max(best, 48);
            }

            foreach (var token in tokens)
            {
                if (string.Equals(token, term, StringComparison.OrdinalIgnoreCase))
                {
                    best = Math.Max(best, 96);
                    continue;
                }

                if (token.StartsWith(term, StringComparison.OrdinalIgnoreCase))
                {
                    best = Math.Max(best, 64);
                    continue;
                }

                if (!shortTerm && !mediumTerm && token.Contains(term, StringComparison.OrdinalIgnoreCase))
                {
                    best = Math.Max(best, 36);
                    continue;
                }

                if (IsFuzzyMatch(token, term))
                {
                    best = Math.Max(best, 24);
                }
            }
        }

        return best;
    }

    public static double ScoreFields(IReadOnlyList<string> expandedTerms, params (string? Value, double Weight)[] fields)
    {
        var score = 0d;
        foreach (var field in fields)
        {
            score += ScoreText(field.Value, expandedTerms) * field.Weight;
        }

        return score;
    }

    public static bool MatchesAny(string? value, IReadOnlyList<string> expandedTerms)
    {
        return ScoreText(value, expandedTerms) > 0;
    }

    private static string Canonicalize(string? value)
    {
        var normalized = NormalizeTerm(value);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return string.Empty;
        }

        return AliasToCanonical.TryGetValue(normalized, out var canonical)
            ? canonical
            : normalized;
    }

    private static string NormalizeTerm(string? value)
    {
        return (value ?? string.Empty)
            .Trim()
            .TrimStart('#')
            .ToLowerInvariant();
    }

    private static string[] SplitTokens(string value)
    {
        return TokenSplitRegex()
            .Split(value)
            .Where(token => !string.IsNullOrWhiteSpace(token))
            .ToArray();
    }

    private static Dictionary<string, string> BuildAliasIndex()
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var topic in Topics)
        {
            map[topic.Canonical] = topic.Canonical;
            foreach (var alias in topic.Aliases)
            {
                map[NormalizeTerm(alias)] = topic.Canonical;
            }
        }

        return map;
    }

    private static bool IsFuzzyMatch(string left, string right)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
        {
            return false;
        }

        if (Math.Abs(left.Length - right.Length) > 1)
        {
            return false;
        }

        if (left.Length < 4 || right.Length < 4)
        {
            return false;
        }

        return LevenshteinDistance(left, right) <= 1;
    }

    private static int LevenshteinDistance(string left, string right)
    {
        var rows = left.Length + 1;
        var cols = right.Length + 1;
        var matrix = new int[rows, cols];

        for (var row = 0; row < rows; row += 1)
        {
            matrix[row, 0] = row;
        }

        for (var col = 0; col < cols; col += 1)
        {
            matrix[0, col] = col;
        }

        for (var row = 1; row < rows; row += 1)
        {
            for (var col = 1; col < cols; col += 1)
            {
                var cost = left[row - 1] == right[col - 1] ? 0 : 1;
                matrix[row, col] = Math.Min(
                    matrix[row - 1, col] + 1,
                    Math.Min(
                        matrix[row, col - 1] + 1,
                        matrix[row - 1, col - 1] + cost));
            }
        }

        return matrix[rows - 1, cols - 1];
    }

    [GeneratedRegex("[^\\p{L}\\p{N}_-]+", RegexOptions.Compiled | RegexOptions.CultureInvariant)]
    private static partial Regex TokenSplitRegex();

    private sealed record DiscoveryTopic(string Canonical, string[] Aliases)
    {
        public IReadOnlyList<string> AllTerms =>
            [Canonical, .. Aliases.Select(alias => NormalizeTerm(alias))];
    }
}
