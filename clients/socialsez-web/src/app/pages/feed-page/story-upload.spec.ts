import { describe, expect, it, vi } from 'vitest';
import { FeedPageComponent } from './feed-page.component';
import { ProfilePageComponent } from '../profile-page/profile-page.component';

describe.each([FeedPageComponent, ProfilePageComponent])('%s story uploads', component => {
    function createComposer(error?: unknown) {
        const file = new File(['photo'], 'screenshot.png', { type: 'image/png' });
        const handle = { succeed: vi.fn(), fail: vi.fn() };
        const state = {
            storyMediaFile: file,
            postingStory: false,
            storyComposerStep: 2,
            showStoryComposer: true,
            storyComposerError: '',
            error: '',
            toScheduledPublishUtcIso: () => null,
            detachStoryFrameDragListeners: vi.fn(),
            detachStoryTrimDragListeners: vi.fn(),
            buildProcessedStoryMedia: vi.fn().mockResolvedValue(file),
            buildStoryThumbnailForUpload: vi.fn().mockResolvedValue(undefined),
            session: {
                createStoryAsync: error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({})
            },
            uploadProgress: { begin: () => handle },
            translate: { instant: () => 'Could not upload your story. Please try again.' },
            recordEngagementActivity: vi.fn().mockResolvedValue(undefined),
            load: vi.fn().mockResolvedValue(undefined),
            clearStoryMediaSelection: vi.fn(),
            destroyRef: { destroyed: false },
            cdr: { detectChanges: vi.fn() }
        };
        return { state, handle, file };
    }

    it('shows the API rejection and retains the selected media for retry', async () => {
        const { state, handle, file } = createComposer({ error: { message: 'Story media is required.' } });
        await component.prototype.publishStory.call(state as unknown as FeedPageComponent & ProfilePageComponent);
        await vi.waitFor(() => expect(handle.fail).toHaveBeenCalledWith('Story media is required.'));
        expect(state.storyComposerError).toBe('Story media is required.');
        expect(state.showStoryComposer).toBe(true);
        expect(state.storyComposerStep).toBe(2);
        expect(state.storyMediaFile).toBe(file);
        expect(state.clearStoryMediaSelection).not.toHaveBeenCalled();
        expect(state.postingStory).toBe(false);
    });

    it('clears media after a successful upload', async () => {
        const { state, handle } = createComposer();
        await component.prototype.publishStory.call(state as unknown as FeedPageComponent & ProfilePageComponent);
        await vi.waitFor(() => expect(handle.succeed).toHaveBeenCalled());
        expect(state.clearStoryMediaSelection).toHaveBeenCalledOnce();
        expect(state.showStoryComposer).toBe(false);
        expect(state.storyComposerStep).toBe(1);
        expect(handle.fail).not.toHaveBeenCalled();
    });

    it('retains the native file selection while advancing to the editor', async () => {
        const { state, file } = createComposer();
        const input = { files: [file], value: 'C:\\fakepath\\screenshot.png' };
        const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:story-photo');
        try {
            await component.prototype.onStoryMediaSelected.call(
                state as unknown as FeedPageComponent & ProfilePageComponent,
                { target: input } as unknown as Event
            );
            expect(state.clearStoryMediaSelection).toHaveBeenCalledWith(false);
            expect(input.value).toBe('C:\\fakepath\\screenshot.png');
            expect(state.storyMediaFile).toBe(file);
            expect(state.storyComposerStep).toBe(2);
        } finally {
            createUrl.mockRestore();
        }
    });

    it('keeps the previous selection if the picker returns no file', async () => {
        const { state, file } = createComposer();
        await component.prototype.onStoryMediaSelected.call(
            state as unknown as FeedPageComponent & ProfilePageComponent,
            { target: { files: [], value: '' } } as unknown as Event
        );
        expect(state.clearStoryMediaSelection).not.toHaveBeenCalled();
        expect(state.storyMediaFile).toBe(file);
    });
});
