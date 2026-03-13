import { Injectable } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { ChatMessageDto } from './api.types';
import { environment } from '../../environments/environment';
import { readAccessToken } from './auth-storage.util';

export interface ChatTypingChangedEvent {
    conversationId: string;
    profileId: string;
    isTyping: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatRealtimeService {
    private readonly hubUrl = `${environment.apiBaseUrl.replace(/\/api\/?$/, '')}/hubs/chat`;
    private readonly messageUpsertedSubject = new Subject<ChatMessageDto>();
    private readonly typingChangedSubject = new Subject<ChatTypingChangedEvent>();
    private hubConnection: HubConnection | null = null;
    private activeConversationId: string | null = null;

    readonly messageUpserted$ = this.messageUpsertedSubject.asObservable();
    readonly typingChanged$ = this.typingChangedSubject.asObservable();

    async joinConversation(conversationId: string): Promise<void> {
        await this.ensureConnected();

        if (!this.hubConnection) {
            return;
        }

        if (this.activeConversationId && this.activeConversationId !== conversationId) {
            await this.hubConnection.invoke('LeaveConversation', this.activeConversationId);
        }

        if (this.activeConversationId === conversationId) {
            return;
        }

        await this.hubConnection.invoke('JoinConversation', conversationId);
        this.activeConversationId = conversationId;
    }

    async leaveConversation(conversationId: string): Promise<void> {
        if (!this.hubConnection || this.hubConnection.state !== HubConnectionState.Connected) {
            if (this.activeConversationId === conversationId) {
                this.activeConversationId = null;
            }

            return;
        }

        await this.hubConnection.invoke('LeaveConversation', conversationId);
        if (this.activeConversationId === conversationId) {
            this.activeConversationId = null;
        }
    }

    async setTyping(conversationId: string, isTyping: boolean): Promise<void> {
        await this.ensureConnected();

        if (!this.hubConnection || this.hubConnection.state !== HubConnectionState.Connected) {
            return;
        }

        await this.hubConnection.invoke('SetTyping', conversationId, isTyping);
    }

    async disconnect(): Promise<void> {
        if (!this.hubConnection) {
            return;
        }

        this.activeConversationId = null;
        await this.hubConnection.stop();
        this.hubConnection = null;
    }

    private async ensureConnected(): Promise<void> {
        if (this.hubConnection && this.hubConnection.state === HubConnectionState.Connected) {
            return;
        }

        if (!this.hubConnection) {
            this.hubConnection = new HubConnectionBuilder()
                .withUrl(this.hubUrl, {
                    accessTokenFactory: () => readAccessToken(),
                    withCredentials: false
                })
                .withAutomaticReconnect()
                .build();

            this.hubConnection.on('MessageUpserted', (message: ChatMessageDto) => {
                this.messageUpsertedSubject.next(message);
            });

            this.hubConnection.on('TypingChanged', (payload: ChatTypingChangedEvent) => {
                if (!payload?.conversationId || !payload?.profileId) {
                    return;
                }

                this.typingChangedSubject.next(payload);
            });
        }

        if (this.hubConnection.state === HubConnectionState.Disconnected) {
            await this.hubConnection.start();
        }
    }
}
