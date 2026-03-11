import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ReelUploadSwStatusEvent {
    type: 'REEL_UPLOAD_STATUS';
    id: string;
    state: 'success' | 'failed';
    message: string;
}

@Injectable({ providedIn: 'root' })
export class ReelBackgroundUploadService implements OnDestroy {
    private readonly statusSubject = new Subject<ReelUploadSwStatusEvent>();

    readonly status$ = this.statusSubject.asObservable();

    private readonly messageListener: (event: MessageEvent) => void;

    constructor(private readonly zone: NgZone) {
        this.messageListener = (event: MessageEvent) => {
            if (event.data?.type === 'REEL_UPLOAD_STATUS') {
                this.zone.run(() => this.statusSubject.next(event.data as ReelUploadSwStatusEvent));
            }
        };

        if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', this.messageListener);
        }
    }

    ngOnDestroy(): void {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
            navigator.serviceWorker.removeEventListener('message', this.messageListener);
        }
        this.statusSubject.complete();
    }

    get isSupported(): boolean {
        return typeof window !== 'undefined'
            && 'serviceWorker' in navigator
            && 'BackgroundFetchManager' in window;
    }

    async uploadReel(
        videoFile: File,
        durationSeconds: number,
        caption: string | undefined,
        thumbnailFile: File | undefined
    ): Promise<void> {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            void Notification.requestPermission();
        }

        const token = localStorage.getItem('socialsez.accessToken') ?? '';

        const formData = new FormData();
        formData.append('video', videoFile);
        formData.append('durationSeconds', `${Math.max(1, Math.round(durationSeconds))}`);
        if (caption?.trim()) formData.append('caption', caption.trim());
        if (thumbnailFile) formData.append('thumbnail', thumbnailFile);

        const request = new Request(`${environment.apiBaseUrl}/reels`, {
            method: 'POST',
            body: formData,
            headers: { Authorization: `Bearer ${token}` }
        });

        const swRegistration = await navigator.serviceWorker.ready;
        const bgFetchManager = (swRegistration as unknown as { backgroundFetch: BackgroundFetchManager }).backgroundFetch;

        await bgFetchManager.fetch(
            `reel-upload-${Date.now()}`,
            [request],
            {
                title: 'Uploading reel…',
                icons: [{ src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' }],
                downloadTotal: videoFile.size + (thumbnailFile?.size ?? 0)
            }
        );
    }
}

interface BackgroundFetchManager {
    fetch(id: string, requests: RequestInfo[], options?: BackgroundFetchOptions): Promise<BackgroundFetchRegistration>;
    get(id: string): Promise<BackgroundFetchRegistration | undefined>;
    getIds(): Promise<string[]>;
}

interface BackgroundFetchOptions {
    title?: string;
    icons?: { src: string; sizes?: string; type?: string }[];
    downloadTotal?: number;
}

interface BackgroundFetchRegistration extends EventTarget {
    readonly id: string;
    readonly uploadTotal: number;
    readonly uploaded: number;
    readonly downloadTotal: number;
    readonly downloaded: number;
    readonly result: '' | 'success' | 'failure';
    readonly failureReason: string;
    abort(): Promise<boolean>;
    matchAll(): Promise<BackgroundFetchRecord[]>;
}

interface BackgroundFetchRecord {
    readonly request: Request;
    readonly responseReady: Promise<Response>;
}
