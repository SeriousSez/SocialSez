import { ReelDto } from './api.types';
import { ReelShareMessageRequest } from './reel-interactions.service';

export interface ReelShareExecutionState {
    sharingReelId: string | null;
    errorMessage: string;
}

export async function executeReelShareToChat(
    state: ReelShareExecutionState,
    reel: ReelDto,
    request: ReelShareMessageRequest,
    shareAction: () => Promise<void>,
    errorMessage: string
): Promise<boolean> {
    if (state.sharingReelId) {
        return false;
    }

    if (!request.recipientIds.length) {
        return false;
    }

    state.sharingReelId = reel.id;
    state.errorMessage = '';

    try {
        await shareAction();
        return true;
    } catch {
        state.errorMessage = errorMessage;
        return false;
    } finally {
        state.sharingReelId = null;
    }
}
