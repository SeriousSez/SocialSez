import { Injectable } from '@angular/core';
import { ReelDto } from './api.types';
import { SessionService } from './session.service';
import { buildSharedReelMarker, buildSharedReelPreview } from './shared-reel.utils';

export interface ReelShareMessageRequest {
    recipientIds: string[];
    groupChatIds?: string[];
    note: string;
    mode: 'separate' | 'group';
}

@Injectable({ providedIn: 'root' })
export class ReelInteractionsService {
    constructor(private readonly session: SessionService) { }

    async toggleLike(reelId: string): Promise<ReelDto> {
        return this.session.toggleReelLikeAsync(reelId);
    }

    async addComment(reelId: string, content: string, parentCommentId?: string | null): Promise<ReelDto> {
        return this.session.addReelCommentAsync(reelId, content, parentCommentId ?? null);
    }

    async updateComment(reelId: string, commentId: string, content: string): Promise<ReelDto> {
        return this.session.updateReelCommentAsync(reelId, commentId, content);
    }

    async deleteComment(reelId: string, commentId: string): Promise<ReelDto> {
        return this.session.deleteReelCommentAsync(reelId, commentId);
    }

    async toggleCommentLike(reelId: string, commentId: string): Promise<ReelDto> {
        return this.session.toggleReelCommentLikeAsync(reelId, commentId);
    }

    async shareToChat(reel: ReelDto, request: ReelShareMessageRequest): Promise<void> {
        const recipientIds = request.recipientIds;
        const groupChatIds = request.groupChatIds ?? [];

        if (!recipientIds.length && !groupChatIds.length) {
            return;
        }

        const shareText = request.note.trim();
        const reelMessage = buildSharedReelMarker(buildSharedReelPreview(reel));
        const sendToConversation = async (conversationId: string): Promise<void> => {
            if (shareText) {
                await this.session.sendChatMessageAsync(conversationId, shareText);
            }
            await this.session.sendChatMessageAsync(conversationId, reelMessage);
        };

        const conversationPromises: Promise<void>[] = [];

        for (const groupChatId of groupChatIds) {
            conversationPromises.push(sendToConversation(groupChatId));
        }

        if (recipientIds.length > 0) {
            if (request.mode === 'group' && recipientIds.length > 1) {
                const group = await this.session.createGroupConversationAsync('', recipientIds);
                conversationPromises.push(sendToConversation(group.id));
            } else {
                for (const recipientId of recipientIds) {
                    const conversation = await this.session.createDirectConversationAsync(recipientId);
                    conversationPromises.push(sendToConversation(conversation.id));
                }
            }
        }

        await Promise.all(conversationPromises);
    }
}