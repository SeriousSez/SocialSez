export interface ChatReplyPreview {
    messageId?: string;
    authorHandle: string;
    text?: string;
    thumbnailUrl?: string;
    sourceType?: 'text' | 'image' | 'gif' | 'post' | 'reel' | 'story';
}

const replyPrefix = '[reply]';

export function buildChatReplyMarker(preview: ChatReplyPreview): string {
    return `${replyPrefix}${encodeChatReplyPayload(preview)}`;
}

export function decodeChatReplyPayload(payload: string): ChatReplyPreview | null {
    const trimmed = payload.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const json = new TextDecoder().decode(base64ToBytes(trimmed));
        const parsed = JSON.parse(json) as Partial<ChatReplyPreview>;

        const authorHandle = (parsed.authorHandle ?? '').trim();
        const text = parsed.text?.trim() || undefined;
        const thumbnailUrl = parsed.thumbnailUrl?.trim() || undefined;
        const sourceType = parsed.sourceType;
        const messageId = parsed.messageId?.trim() || undefined;

        if (!authorHandle) {
            return null;
        }

        return {
            messageId,
            authorHandle,
            text,
            thumbnailUrl,
            sourceType
        };
    } catch {
        return null;
    }
}

export function isChatReplyMarker(line: string): boolean {
    return line.trim().startsWith(replyPrefix);
}

export function stripChatReplyMarkerPrefix(line: string): string {
    return line.trim().slice(replyPrefix.length);
}

function encodeChatReplyPayload(preview: ChatReplyPreview): string {
    const serialized = JSON.stringify(preview);
    return bytesToBase64(new TextEncoder().encode(serialized));
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
