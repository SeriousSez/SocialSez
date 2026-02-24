import { StoryDto } from './api.types';

export interface StoryShareModalState {
    sharingStoryId: string | null;
    pendingShareStory: StoryDto | null;
}

export function cancelStoryShareModal(state: StoryShareModalState): boolean {
    if (state.sharingStoryId) {
        return false;
    }

    state.pendingShareStory = null;
    return true;
}

export function openStoryShareModal(
    state: StoryShareModalState,
    story: StoryDto,
    ...busyFlags: boolean[]
): boolean {
    if (state.sharingStoryId || busyFlags.some(Boolean)) {
        return false;
    }

    state.pendingShareStory = story;
    return true;
}
