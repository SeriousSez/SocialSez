import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
    selector: 'app-confirm-modal',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './confirm-modal.component.html',
    styleUrl: './confirm-modal.component.scss'
})
export class ConfirmModalComponent {
    @Input() open = false;
    @Input() title = 'Confirm action';
    @Input() message = '';
    @Input() confirmText = 'Confirm';
    @Input() cancelText = 'Cancel';
    @Input() confirmClass = '';
    @Input() busy = false;

    @Output() confirm = new EventEmitter<void>();
    @Output() cancel = new EventEmitter<void>();

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.open && !this.busy) {
            this.cancel.emit();
        }
    }

    onBackdropClick(event: MouseEvent): void {
        if (this.busy) {
            return;
        }

        const target = event.target as HTMLElement;
        if (target.classList.contains('modal-overlay')) {
            this.cancel.emit();
        }
    }
}
