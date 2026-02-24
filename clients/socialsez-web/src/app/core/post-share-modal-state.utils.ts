import { PostDto } from './api.types';

export type PostShareTarget = 'feed' | 'chat';

export interface PostShareModalState {
    sharingPostId: string | null;
    pendingSharePost: PostDto | null;
    pendingShareTarget: PostShareTarget | null;
    shareNote: string;
}

export function cancelPostShareModal(state: PostShareModalState): boolean {
    if (state.sharingPostId) {
        return false;
    }

    state.pendingSharePost = null;
    state.pendingShareTarget = null;
    state.shareNote = '';
    return true;
}

export function openPostShareModal(
    state: PostShareModalState,
    post: PostDto,
    target: PostShareTarget,
    ...busyFlags: boolean[]
): boolean {
    if (state.sharingPostId || busyFlags.some(Boolean)) {
        return false;
    }

    state.pendingSharePost = post;
    state.pendingShareTarget = target;
    state.shareNote = '';
    return true;
}