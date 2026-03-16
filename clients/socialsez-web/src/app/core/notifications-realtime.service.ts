import { Injectable } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { NotificationDto } from './api.types';
import { readAccessToken } from './auth-storage.util';

@Injectable({ providedIn: 'root' })
export class NotificationsRealtimeService {
    private readonly hubUrl = `${environment.apiBaseUrl.replace(/\/api\/?$/, '')}/hubs/notifications`;
    private readonly notificationCreatedSource = new Subject<NotificationDto>();
    private hubConnection: HubConnection | null = null;

    readonly notificationCreated$ = this.notificationCreatedSource.asObservable();

    async connect(): Promise<void> {
        const token = readAccessToken();
        if (!token) {
            await this.disconnect();
            return;
        }

        await this.ensureConnected();
    }

    async disconnect(): Promise<void> {
        if (!this.hubConnection) {
            return;
        }

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

            this.hubConnection.on('NotificationCreated', (notification: NotificationDto) => {
                if (!notification?.id || !notification?.recipientId) {
                    return;
                }

                this.notificationCreatedSource.next(notification);
            });
        }

        if (this.hubConnection.state === HubConnectionState.Disconnected) {
            await this.hubConnection.start();
        }
    }
}
