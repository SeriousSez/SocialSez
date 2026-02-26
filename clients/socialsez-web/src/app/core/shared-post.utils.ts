import { PostDto } from './api.types';

export interface SharedPostPreview {
    postId: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    imageUrl?: string;
    createdAtUtc: string;
}

const sharedPostPrefix = '[post]';
const imagePrefix = '[image]';
const gifPrefix = '[gif]';

export function buildSharedPostPreview(post: PostDto): SharedPostPreview {
    const parsedExisting = extractSharedPostFromContent(post.content).sharedPost;
    if (parsedExisting) {
        return parsedExisting;
    }

    return {
        postId: post.id,
        authorHandle: post.authorHandle,
        authorImageUrl: post.authorImageUrl,
        content: stripMessageMarkers(post.content),
        imageUrl: post.imageUrl,
        createdAtUtc: post.createdAtUtc
    };
}

export function encodeSharedPostPayload(preview: SharedPostPreview): string {
    const serialized = JSON.stringify(preview);
    return bytesToBase64(new TextEncoder().encode(serialized));
}

export function decodeSharedPostPayload(payload: string): SharedPostPreview | null {
    const trimmed = payload.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const json = new TextDecoder().decode(base64ToBytes(trimmed));
        const parsed = JSON.parse(json) as Partial<SharedPostPreview>;

        const postId = (parsed.postId ?? '').trim();
        const authorHandle = (parsed.authorHandle ?? '').trim();
        const content = (parsed.content ?? '').trim();
        const createdAtUtc = (parsed.createdAtUtc ?? '').trim();
        const authorImageUrl = parsed.authorImageUrl?.trim() || undefined;
        const imageUrl = parsed.imageUrl?.trim() || undefined;

        if (!postId || !authorHandle || !createdAtUtc) {
            return null;
        }

        return {
            postId,
            authorHandle,
            authorImageUrl,
            content,
            imageUrl,
            createdAtUtc
        };
    } catch {
        return null;
    }
}

export function buildSharedPostMarker(preview: SharedPostPreview): string {
    return `${sharedPostPrefix}${encodeSharedPostPayload(preview)}`;
}

export function extractSharedPostFromContent(content: string): { text: string; sharedPost: SharedPostPreview | null } {
    const lines = content.split(/\r?\n/);
    const textLines: string[] = [];
    let sharedPost: SharedPostPreview | null = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            textLines.push(rawLine);
            continue;
        }

        if (line.startsWith(sharedPostPrefix)) {
            const decoded = decodeSharedPostPayload(line.slice(sharedPostPrefix.length));
            if (decoded) {
                sharedPost = decoded;
                continue;
            }
        }

        textLines.push(rawLine);
    }

    return {
        text: textLines.join('\n').trim(),
        sharedPost
    };
}

export function buildSharedPostReferenceCounts(posts: ReadonlyArray<PostDto>): Map<string, number> {
    const counts = new Map<string, number>();

    for (const post of posts) {
        const sharedPost = extractSharedPostFromContent(post.content).sharedPost;
        const sourcePostId = sharedPost?.postId;
        if (!sourcePostId) {
            continue;
        }

        counts.set(sourcePostId, (counts.get(sourcePostId) ?? 0) + 1);
    }

    return counts;
}

function stripMessageMarkers(content: string): string {
    const lines = content.split(/\r?\n/);
    const cleaned = lines
        .filter(line => {
            const trimmed = line.trim();
            return trimmed
                && !trimmed.startsWith(imagePrefix)
                && !trimmed.startsWith(gifPrefix)
                && !trimmed.startsWith(sharedPostPrefix);
        })
        .join('\n')
        .trim();

    return cleaned;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}
