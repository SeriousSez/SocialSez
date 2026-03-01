import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-create-content-menu',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './create-content-menu.component.html',
    styleUrl: './create-content-menu.component.scss'
})
export class CreateContentMenuComponent {
    @Input() open = false;

    @Output() toggle = new EventEmitter<Event>();
    @Output() createPost = new EventEmitter<void>();
    @Output() createReel = new EventEmitter<void>();
    @Output() createStory = new EventEmitter<void>();
    private toggleHandledByPointer = false;

    onTogglePointerDown(event: PointerEvent): void {
        this.toggleHandledByPointer = true;
        this.toggle.emit(event);
    }

    onToggleClick(event: MouseEvent): void {
        if (this.toggleHandledByPointer) {
            this.toggleHandledByPointer = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        this.toggle.emit(event);
    }

    onCreatePost(): void {
        this.createPost.emit();
    }

    onCreateReel(): void {
        this.createReel.emit();
    }

    onCreateStory(): void {
        this.createStory.emit();
    }
}