import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SharedStoryPreview } from '../../core/shared-story.utils';

@Component({
    selector: 'app-chat-shared-story-preview',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './chat-shared-story-preview.component.html',
    styleUrl: './chat-shared-story-preview.component.scss'
})
export class ChatSharedStoryPreviewComponent {
    @Input({ required: true }) sharedStory!: SharedStoryPreview;
    @Input() messageAuthorHandle = '';
    @Input() messageAuthorImageUrl?: string;

    @Output() openRequested = new EventEmitter<MouseEvent>();

    get authorHandle(): string {
        return this.sharedStory.authorHandle || this.messageAuthorHandle || 'story';
    }

    onOpen(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.openRequested.emit(event);
    }

    isVideoMedia(url: string | null | undefined): boolean {
        const value = (url ?? '').toLowerCase();
        return /\.(mp4|webm|mov|m4v|ogg)(\?|$)/.test(value);
    }
}
