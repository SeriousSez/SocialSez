import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';

@Component({
    selector: 'app-comments-sheet',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './comments-sheet.component.html',
    styleUrl: './comments-sheet.component.scss'
})
export class CommentsSheetComponent {
    private static readonly CloseAnimationMs = 220;

    @Input() open = false;
    @Input() title = 'Comments';
    @Output() close = new EventEmitter<void>();

    rendered = false;
    closing = false;
    private closeTimerId: number | null = null;

    ngOnChanges(changes: SimpleChanges): void {
        if (!changes['open']) {
            return;
        }

        if (this.open) {
            this.clearCloseTimer();
            this.rendered = true;
            this.closing = false;
            return;
        }

        if (this.rendered) {
            this.startClosing();
        }
    }

    ngOnDestroy(): void {
        this.clearCloseTimer();
    }

    requestClose(): void {
        if (this.closing) {
            return;
        }

        if (this.open) {
            this.startClosing();
        }

        this.close.emit();
    }

    private startClosing(): void {
        this.clearCloseTimer();
        this.closing = true;
        this.closeTimerId = window.setTimeout(() => {
            this.rendered = false;
            this.closing = false;
            this.closeTimerId = null;
        }, CommentsSheetComponent.CloseAnimationMs);
    }

    private clearCloseTimer(): void {
        if (this.closeTimerId === null) {
            return;
        }

        window.clearTimeout(this.closeTimerId);
        this.closeTimerId = null;
    }
}
