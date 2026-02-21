import { Injectable } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { ChatMessageDto } from './api.types';

@Injectable({ providedIn: 'root' })
export class ChatRealtimeService {
    private readonly hubUrl = 'http://localhost:5100/hubs/chat';
    private readonly messageUpsertedSubject = new Subject<ChatMessageDto>();
    private hubConnection: HubConnection | null = null;
    private activeConversationId: string | null = null;

    readonly messageUpserted$ = this.messageUpsertedSubject.asObservable();

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
                    accessTokenFactory: () => localStorage.getItem('socialsez.accessToken') ?? '',
                    withCredentials: false
                })
                .withAutomaticReconnect()
                .build();

            this.hubConnection.on('MessageUpserted', (message: ChatMessageDto) => {
                this.messageUpsertedSubject.next(message);
            });
        }

        if (this.hubConnection.state === HubConnectionState.Disconnected) {
            await this.hubConnection.start();
        }
    }
}
