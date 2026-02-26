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

    @Output() toggle = new EventEmitter<MouseEvent>();
    @Output() createPost = new EventEmitter<void>();
    @Output() createReel = new EventEmitter<void>();
    @Output() createStory = new EventEmitter<void>();

    onToggle(event: MouseEvent): void {
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