import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SharedReelPreview } from '../../core/shared-reel.utils';

@Component({
    selector: 'app-chat-shared-reel-preview',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './chat-shared-reel-preview.component.html',
    styleUrl: './chat-shared-reel-preview.component.scss'
})
export class ChatSharedReelPreviewComponent {
    @Input({ required: true }) sharedReel!: SharedReelPreview;
    @Input() messageAuthorHandle = '';
    @Input() messageAuthorImageUrl?: string;
    @Input() unavailable = false;

    @Output() openRequested = new EventEmitter<MouseEvent>();

    get authorHandle(): string {
        return this.sharedReel.authorHandle || this.messageAuthorHandle || 'shared reel';
    }

    get authorImageUrl(): string | undefined {
        return this.sharedReel.authorImageUrl || this.messageAuthorImageUrl;
    }

    onOpen(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        if (this.unavailable) {
            return;
        }

        this.openRequested.emit(event);
    }

    isVideoMedia(url: string | null | undefined): boolean {
        const value = (url ?? '').toLowerCase();
        return /\.(mp4|webm|mov|m4v|ogg)(\?|$)/.test(value);
    }
}
