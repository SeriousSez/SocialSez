import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

interface UnfurlPreviewLike {
    title?: string;
    description?: string;
    imageUrl?: string;
}

@Component({
    selector: 'app-chat-shared-link-preview',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './chat-shared-link-preview.component.html',
    styleUrl: './chat-shared-link-preview.component.scss'
})
export class ChatSharedLinkPreviewComponent {
    @Input({ required: true }) unfurlUrl = '';
    @Input() preview: UnfurlPreviewLike | null = null;
    @Input() loading = false;

    @Output() openRequested = new EventEmitter<MouseEvent>();

    onOpen(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.openRequested.emit(event);
    }
}
