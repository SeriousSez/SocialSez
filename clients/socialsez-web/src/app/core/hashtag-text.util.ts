export interface HashtagTextPart {
    text: string;
    hashtag?: string;
}

export function splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
    const text = content ?? '';
    if (!text.length) {
        return [];
    }

    const hashtagRegex = /#[\p{L}\p{N}_-]+/gu;
    return text.split('\n').map(line => {
        const parts: HashtagTextPart[] = [];
        let cursor = 0;

        for (const match of line.matchAll(hashtagRegex)) {
            const value = match[0] ?? '';
            const index = match.index ?? 0;
            if (!value) {
                continue;
            }

            if (index > cursor) {
                parts.push({ text: line.slice(cursor, index) });
            }

            parts.push({
                text: value,
                hashtag: value.slice(1)
            });

            cursor = index + value.length;
        }

        if (cursor < line.length) {
            parts.push({ text: line.slice(cursor) });
        }

        return parts.length ? parts : [{ text: '' }];
    });
}
