import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-text-input-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './text-input-modal.component.html',
    styleUrl: './text-input-modal.component.scss'
})
export class TextInputModalComponent implements OnChanges {
    @Input() open = false;
    @Input() title = 'Update value';
    @Input() message = '';
    @Input() label = 'Value';
    @Input() placeholder = '';
    @Input() value = '';
    @Input() confirmText = 'Save';
    @Input() cancelText = 'Cancel';
    @Input() busy = false;
    @Input() busyText = 'Saving...';
    @Input() maxLength = 120;

    @Output() valueChange = new EventEmitter<string>();
    @Output() confirm = new EventEmitter<string>();
    @Output() cancel = new EventEmitter<void>();

    draftValue = '';

    ngOnChanges(changes: SimpleChanges): void {
        if ((changes['open']?.currentValue === true && !changes['open']?.previousValue) || changes['value']) {
            this.draftValue = this.value ?? '';
        }
    }

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

    onDraftValueChange(nextValue: string): void {
        this.draftValue = nextValue;
        this.valueChange.emit(nextValue);
    }

    onSubmit(): void {
        if (this.busy) {
            return;
        }

        this.confirm.emit(this.draftValue);
    }
}
