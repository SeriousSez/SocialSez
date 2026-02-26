import { StoryDto } from './api.types';

export interface SharedStoryPreview {
    storyId?: string;
    authorHandle?: string;
    mediaUrl: string;
    thumbnailUrl?: string;
    createdAtUtc?: string;
    expiresAtUtc?: string;
}

const sharedStoryPrefix = '[story]';

export function buildSharedStoryPreview(story: StoryDto): SharedStoryPreview {
    const mediaUrl = (story.mediaUrl ?? '').trim();

    return {
        storyId: story.id,
        authorHandle: story.authorHandle,
        mediaUrl,
        thumbnailUrl: isImageUrl(mediaUrl) ? mediaUrl : undefined,
        createdAtUtc: story.createdAtUtc,
        expiresAtUtc: story.expiresAtUtc
    };
}

export function encodeSharedStoryPayload(preview: SharedStoryPreview): string {
    const serialized = JSON.stringify(preview);
    return bytesToBase64(new TextEncoder().encode(serialized));
}

export function decodeSharedStoryPayload(payload: string): SharedStoryPreview | null {
    const trimmed = payload.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const json = new TextDecoder().decode(base64ToBytes(trimmed));
        const parsed = JSON.parse(json) as Partial<SharedStoryPreview>;

        const mediaUrl = (parsed.mediaUrl ?? '').trim();
        if (!mediaUrl) {
            return null;
        }

        return {
            storyId: parsed.storyId?.trim() || undefined,
            authorHandle: parsed.authorHandle?.trim() || undefined,
            mediaUrl,
            thumbnailUrl: parsed.thumbnailUrl?.trim() || undefined,
            createdAtUtc: parsed.createdAtUtc?.trim() || undefined,
            expiresAtUtc: parsed.expiresAtUtc?.trim() || undefined
        };
    } catch {
        return null;
    }
}

export function buildSharedStoryMarker(preview: SharedStoryPreview): string {
    return `${sharedStoryPrefix}${encodeSharedStoryPayload(preview)}`;
}

function isImageUrl(url: string): boolean {
    return /\.(png|jpe?g|webp|bmp|svg|gif)(\?|$)/i.test(url);
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
