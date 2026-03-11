import { Injectable } from '@angular/core';
import { PostDto } from './api.types';
import { SessionService } from './session.service';
import { buildSharedPostMarker, buildSharedPostPreview } from './shared-post.utils';

export interface PostShareMessageRequest {
    recipientIds: string[];
    groupChatIds?: string[];
    note: string;
    mode: 'separate' | 'group';
}

@Injectable({ providedIn: 'root' })
export class PostInteractionsService {
    constructor(private readonly session: SessionService) { }

    isAuthenticated(): boolean {
        return this.session.isAuthenticated();
    }

    async toggleLike(postId: string): Promise<PostDto> {
        return this.session.togglePostLikeAsync(postId);
    }

    async setReaction(postId: string, reactionType: string): Promise<PostDto> {
        return this.session.setPostReactionAsync(postId, reactionType);
    }

    async clearReaction(postId: string): Promise<PostDto> {
        return this.session.clearPostReactionAsync(postId);
    }

    async addComment(postId: string, content: string, parentCommentId?: string | null): Promise<PostDto> {
        return this.session.addCommentAsync(postId, content, parentCommentId);
    }

    async updateComment(postId: string, commentId: string, content: string): Promise<PostDto> {
        return this.session.updateCommentAsync(postId, commentId, content);
    }

    async deleteComment(postId: string, commentId: string): Promise<PostDto> {
        return this.session.deleteCommentAsync(postId, commentId);
    }

    async setCommentReaction(postId: string, commentId: string, reactionType: string): Promise<PostDto> {
        return this.session.setCommentReactionAsync(postId, commentId, reactionType);
    }

    async clearCommentReaction(postId: string, commentId: string): Promise<PostDto> {
        return this.session.clearCommentReactionAsync(postId, commentId);
    }

    async shareToFeed(post: PostDto, note: string): Promise<void> {
        const marker = buildSharedPostMarker(buildSharedPostPreview(post));
        const trimmedNote = note.trim();
        const message = trimmedNote ? `${trimmedNote}\n${marker}` : marker;
        await this.session.createPostAsync(message);
    }

    async shareToChat(post: PostDto, request: PostShareMessageRequest): Promise<void> {
        const recipientIds = request.recipientIds;
        const groupChatIds = request.groupChatIds ?? [];

        if (!recipientIds.length && !groupChatIds.length) {
            return;
        }

        const marker = buildSharedPostMarker(buildSharedPostPreview(post));
        const shareText = request.note.trim();
        const sendToConversation = async (conversationId: string): Promise<void> => {
            if (shareText) {
                await this.session.sendChatMessageAsync(conversationId, shareText);
            }
            await this.session.sendChatMessageAsync(conversationId, marker);
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