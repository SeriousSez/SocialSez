import { StoryDto } from './api.types';
import { ShareReelMessageSubmit } from '../shared/share-reel-message-modal/share-reel-message-modal.component';

export interface StoryShareExecutionState {
    sharingStoryId: string | null;
    sharingStoryMessage: boolean;
    errorMessage: string;
}

export interface StoryShareTransport {
    createGroupConversationAsync(name: string, participantIds: string[]): Promise<{ id: string }>;
    createDirectConversationAsync(recipientId: string): Promise<{ id: string }>;
    sendChatMessageAsync(conversationId: string, content: string): Promise<unknown>;
}

export async function executeStoryShareToChat(
    state: StoryShareExecutionState,
    transport: StoryShareTransport,
    story: StoryDto,
    request: ShareReelMessageSubmit,
    storyMessage: string,
    errorMessage: string
): Promise<boolean> {
    if (state.sharingStoryId) {
        return false;
    }

    const recipientIds = request.recipientIds;
    if (!recipientIds.length) {
        return false;
    }

    state.sharingStoryId = story.id;
    state.sharingStoryMessage = true;
    state.errorMessage = '';

    try {
        const shareText = request.note.trim();
        const sendToConversation = async (conversationId: string): Promise<void> => {
            if (shareText) {
                await transport.sendChatMessageAsync(conversationId, shareText);
            }

            await transport.sendChatMessageAsync(conversationId, storyMessage);
        };

        if (request.mode === 'group' && recipientIds.length > 1) {
            const group = await transport.createGroupConversationAsync('', recipientIds);
            await sendToConversation(group.id);
        } else {
            await Promise.all(recipientIds.map(async (recipientId) => {
                const conversation = await transport.createDirectConversationAsync(recipientId);
                await sendToConversation(conversation.id);
            }));
        }

        return true;
    } catch {
        state.errorMessage = errorMessage;
        return false;
    } finally {
        state.sharingStoryId = null;
        state.sharingStoryMessage = false;
    }
}
