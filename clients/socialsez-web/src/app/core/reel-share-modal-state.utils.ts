import { ReelDto } from './api.types';

export interface ReelShareModalState {
    sharingReelId: string | null;
    pendingShareReel: ReelDto | null;
}

export function cancelReelShareModal(state: ReelShareModalState): boolean {
    if (state.sharingReelId) {
        return false;
    }

    state.pendingShareReel = null;
    return true;
}

export function openReelShareModal(
    state: ReelShareModalState,
    reel: ReelDto,
    ...busyFlags: boolean[]
): boolean {
    if (state.sharingReelId || busyFlags.some(Boolean)) {
        return false;
    }

    state.pendingShareReel = reel;
    return true;
}