import { ReelCommentDto, ReelDto } from './api.types';

export interface SharedReelCommentPreview {
    id: string;
    parentCommentId?: string;
    authorHandle: string;
    authorImageUrl?: string;
    content: string;
    createdAtUtc: string;
    likeCount?: number;
    likedByMe?: boolean;
}

export interface SharedReelPreview {
    reelId?: string;
    authorHandle?: string;
    authorImageUrl?: string;
    caption?: string;
    videoUrl: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
    createdAtUtc?: string;
    likeCount?: number;
    likedByMe?: boolean;
    comments?: SharedReelCommentPreview[];
}

const sharedReelPrefix = '[reel]';

export function buildSharedReelPreview(reel: ReelDto): SharedReelPreview {
    return {
        reelId: reel.id,
        authorHandle: reel.authorHandle,
        authorImageUrl: reel.authorImageUrl,
        caption: reel.caption,
        videoUrl: reel.videoUrl,
        thumbnailUrl: reel.thumbnailUrl,
        durationSeconds: reel.durationSeconds,
        createdAtUtc: reel.createdAtUtc,
        likeCount: reel.likeCount,
        likedByMe: reel.likedByMe,
        comments: mapComments(reel.comments)
    };
}

export function encodeSharedReelPayload(preview: SharedReelPreview): string {
    const serialized = JSON.stringify(preview);
    return bytesToBase64(new TextEncoder().encode(serialized));
}

export function decodeSharedReelPayload(payload: string): SharedReelPreview | null {
    const trimmed = payload.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const json = new TextDecoder().decode(base64ToBytes(trimmed));
        const parsed = JSON.parse(json) as Partial<SharedReelPreview>;
        const videoUrl = (parsed.videoUrl ?? '').trim();
        if (!videoUrl) {
            return null;
        }

        const reelId = parsed.reelId?.trim() || undefined;
        const authorHandle = parsed.authorHandle?.trim() || undefined;
        const authorImageUrl = parsed.authorImageUrl?.trim() || undefined;
        const caption = parsed.caption?.trim() || undefined;
        const thumbnailUrl = parsed.thumbnailUrl?.trim() || undefined;
        const durationSeconds = typeof parsed.durationSeconds === 'number' && Number.isFinite(parsed.durationSeconds)
            ? parsed.durationSeconds
            : undefined;
        const createdAtUtc = parsed.createdAtUtc?.trim() || undefined;
        const likeCount = typeof parsed.likeCount === 'number' && Number.isFinite(parsed.likeCount)
            ? Math.max(0, Math.floor(parsed.likeCount))
            : undefined;
        const likedByMe = typeof parsed.likedByMe === 'boolean' ? parsed.likedByMe : undefined;
        const comments = Array.isArray(parsed.comments)
            ? parsed.comments
                .map(comment => mapSharedComment(comment as Partial<SharedReelCommentPreview>))
                .filter((comment): comment is SharedReelCommentPreview => !!comment)
            : undefined;

        return {
            reelId,
            authorHandle,
            authorImageUrl,
            caption,
            videoUrl,
            thumbnailUrl,
            durationSeconds,
            createdAtUtc,
            likeCount,
            likedByMe,
            comments
        };
    } catch {
        return null;
    }
}

export function buildSharedReelMarker(preview: SharedReelPreview): string {
    return `${sharedReelPrefix}${encodeSharedReelPayload(preview)}`;
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

function mapComments(comments: ReadonlyArray<ReelCommentDto>): SharedReelCommentPreview[] {
    return comments.map(comment => ({
        id: comment.id,
        parentCommentId: comment.parentCommentId,
        authorHandle: comment.authorHandle,
        authorImageUrl: comment.authorImageUrl,
        content: comment.content,
        createdAtUtc: comment.createdAtUtc,
        likeCount: comment.likeCount,
        likedByMe: comment.likedByMe
    }));
}

function mapSharedComment(comment: Partial<SharedReelCommentPreview>): SharedReelCommentPreview | null {
    const id = comment.id?.trim();
    const authorHandle = comment.authorHandle?.trim();
    const content = comment.content?.trim();
    const createdAtUtc = comment.createdAtUtc?.trim();
    if (!id || !authorHandle || !content || !createdAtUtc) {
        return null;
    }

    return {
        id,
        parentCommentId: comment.parentCommentId?.trim() || undefined,
        authorHandle,
        authorImageUrl: comment.authorImageUrl?.trim() || undefined,
        content,
        createdAtUtc,
        likeCount: typeof comment.likeCount === 'number' && Number.isFinite(comment.likeCount)
            ? Math.max(0, Math.floor(comment.likeCount))
            : undefined,
        likedByMe: typeof comment.likedByMe === 'boolean' ? comment.likedByMe : undefined
    };
}
