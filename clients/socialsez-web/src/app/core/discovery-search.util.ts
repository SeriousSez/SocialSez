export interface DiscoveryTopic {
    canonical: string;
    aliases: string[];
}

export interface DiscoveryWeightedField {
    value: string | null | undefined;
    weight?: number;
}

export interface DiscoveryRankOptions<T> {
    query: string | null | undefined;
    score: (item: T, expandedTerms: ReadonlyArray<string>) => number;
    tieBreaker?: (left: T, right: T) => number;
    onEmptyQuery?: (items: ReadonlyArray<T>) => T[];
    minScore?: number;
}

export const DISCOVERY_TOPICS: ReadonlyArray<DiscoveryTopic> = [
    { canonical: 'startup', aliases: ['startups', 'founder', 'founders', 'launch'] },
    { canonical: 'build-in-public', aliases: ['building-in-public', 'buildinpublic', 'bip', 'devlog'] },
    { canonical: 'saas', aliases: ['software', 'product', 'products'] },
    { canonical: 'ai', aliases: ['ml', 'machine-learning', 'llm'] },
    { canonical: 'community', aliases: ['communities', 'social', 'network'] },
    { canonical: 'webdev', aliases: ['frontend', 'backend', 'fullstack', 'javascript', 'typescript'] },
    { canonical: 'mobile', aliases: ['android', 'ios', 'flutter', 'react-native'] },
    { canonical: 'security', aliases: ['privacy', 'safety'] },
    { canonical: 'productivity', aliases: ['workflow', 'automation'] },
    { canonical: 'creator', aliases: ['creators', 'content', 'blogging'] }
];

const aliasToCanonical = buildAliasIndex();

export function normalizeDiscoveryTerm(value: string | null | undefined): string {
    return (value ?? '')
        .trim()
        .replace(/^#/, '')
        .toLowerCase();
}

export function canonicalizeTopicOrTag(value: string | null | undefined): string {
    const normalized = normalizeDiscoveryTerm(value);
    if (!normalized) {
        return '';
    }

    return aliasToCanonical.get(normalized) ?? normalized;
}

export function expandDiscoveryTerms(query: string | null | undefined): string[] {
    const normalized = normalizeDiscoveryTerm(query);
    if (!normalized) {
        return [];
    }

    const terms = new Set<string>([normalized]);
    const canonical = canonicalizeTopicOrTag(normalized);
    terms.add(canonical);

    if (canonical.endsWith('s') && canonical.length > 3) {
        terms.add(canonical.slice(0, -1));
    } else if (canonical.length > 2) {
        terms.add(`${canonical}s`);
    }

    for (const topic of DISCOVERY_TOPICS) {
        const all = [topic.canonical, ...topic.aliases].map(item => normalizeDiscoveryTerm(item));
        if (!all.some(item => item.includes(normalized) || normalized.includes(item))) {
            continue;
        }

        for (const item of all) {
            terms.add(item);
        }
    }

    return Array.from(terms).filter(item => !!item);
}

export function scoreDiscoveryText(value: string | null | undefined, expandedTerms: ReadonlyArray<string>): number {
    const normalized = normalizeDiscoveryTerm(value);
    if (!normalized || expandedTerms.length === 0) {
        return 0;
    }

    const tokens = normalized.split(/[^\p{L}\p{N}_-]+/u).filter(token => !!token);
    let best = 0;

    for (const term of expandedTerms) {
        if (!term) {
            continue;
        }

        if (normalized === term) {
            best = Math.max(best, 120);
            continue;
        }

        if (normalized.startsWith(term)) {
            best = Math.max(best, 80);
        }

        if (normalized.includes(term)) {
            best = Math.max(best, 48);
        }

        for (const token of tokens) {
            if (token === term) {
                best = Math.max(best, 96);
                continue;
            }

            if (token.startsWith(term)) {
                best = Math.max(best, 64);
                continue;
            }

            if (token.includes(term)) {
                best = Math.max(best, 36);
                continue;
            }

            if (isFuzzyMatch(token, term)) {
                best = Math.max(best, 24);
            }
        }
    }

    return best;
}

export function matchesDiscoveryValue(value: string | null | undefined, expandedTerms: ReadonlyArray<string>): boolean {
    return scoreDiscoveryText(value, expandedTerms) > 0;
}

export function scoreDiscoveryFields(expandedTerms: ReadonlyArray<string>, fields: ReadonlyArray<DiscoveryWeightedField>): number {
    let score = 0;
    for (const field of fields) {
        score += scoreDiscoveryText(field.value, expandedTerms) * (field.weight ?? 1);
    }

    return score;
}

export function rankByDiscoveryQuery<T>(items: ReadonlyArray<T>, options: DiscoveryRankOptions<T>): T[] {
    const expandedTerms = expandDiscoveryTerms(options.query);
    if (!expandedTerms.length) {
        return options.onEmptyQuery ? options.onEmptyQuery(items) : [...items];
    }

    const minScore = options.minScore ?? Number.NEGATIVE_INFINITY;
    return items
        .map(item => ({ item, score: options.score(item, expandedTerms) }))
        .filter(item => item.score > minScore)
        .sort((left, right) => right.score - left.score || (options.tieBreaker ? options.tieBreaker(left.item, right.item) : 0))
        .map(item => item.item);
}

export function buildDiscoverySuggestions(query: string, seedTags: ReadonlyArray<string>, limit = 8): string[] {
    const expanded = expandDiscoveryTerms(query);
    if (!expanded.length) {
        return [];
    }

    const pool = new Set<string>();
    for (const topic of DISCOVERY_TOPICS) {
        pool.add(topic.canonical);
        for (const alias of topic.aliases) {
            pool.add(alias);
        }
    }

    for (const tag of seedTags) {
        const normalized = normalizeDiscoveryTerm(tag);
        if (normalized) {
            pool.add(normalized);
        }
    }

    return Array.from(pool)
        .map(item => canonicalizeTopicOrTag(item))
        .filter((item, index, all) => !!item && all.indexOf(item) === index)
        .filter(item => scoreDiscoveryText(item, expanded) > 0)
        .sort((left, right) => scoreDiscoveryText(right, expanded) - scoreDiscoveryText(left, expanded) || left.localeCompare(right))
        .slice(0, limit);
}

function buildAliasIndex(): Map<string, string> {
    const map = new Map<string, string>();
    for (const topic of DISCOVERY_TOPICS) {
        const canonical = normalizeDiscoveryTerm(topic.canonical);
        map.set(canonical, canonical);
        for (const alias of topic.aliases) {
            map.set(normalizeDiscoveryTerm(alias), canonical);
        }
    }

    return map;
}

function isFuzzyMatch(left: string, right: string): boolean {
    if (!left || !right) {
        return false;
    }

    if (Math.abs(left.length - right.length) > 1) {
        return false;
    }

    if (left.length < 4 || right.length < 4) {
        return false;
    }

    return levenshteinDistance(left, right) <= 1;
}

function levenshteinDistance(left: string, right: string): number {
    const rows = left.length + 1;
    const cols = right.length + 1;
    const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

    for (let row = 0; row < rows; row += 1) {
        matrix[row][0] = row;
    }

    for (let col = 0; col < cols; col += 1) {
        matrix[0][col] = col;
    }

    for (let row = 1; row < rows; row += 1) {
        for (let col = 1; col < cols; col += 1) {
            const cost = left[row - 1] === right[col - 1] ? 0 : 1;
            matrix[row][col] = Math.min(
                matrix[row - 1][col] + 1,
                matrix[row][col - 1] + 1,
                matrix[row - 1][col - 1] + cost
            );
        }
    }

    return matrix[rows - 1][cols - 1];
}
