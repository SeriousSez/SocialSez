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
    const groupChatIds = request.groupChatIds ?? [];

    if (!recipientIds.length && !groupChatIds.length) {
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

        const conversationPromises: Promise<void>[] = [];

        // Send to existing group chats directly
        for (const groupChatId of groupChatIds) {
            conversationPromises.push(sendToConversation(groupChatId));
        }

        // Handle individual recipients
        if (recipientIds.length > 0) {
            if (request.mode === 'group' && recipientIds.length > 1) {
                const group = await transport.createGroupConversationAsync('', recipientIds);
                conversationPromises.push(sendToConversation(group.id));
            } else {
                for (const recipientId of recipientIds) {
                    const conversation = await transport.createDirectConversationAsync(recipientId);
                    conversationPromises.push(sendToConversation(conversation.id));
                }
            }
        }

        await Promise.all(conversationPromises);
        return true;
    } catch {
        state.errorMessage = errorMessage;
        return false;
    } finally {
        state.sharingStoryId = null;
        state.sharingStoryMessage = false;
    }
}
