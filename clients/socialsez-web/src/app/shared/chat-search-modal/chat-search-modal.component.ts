import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileDto } from '../../core/api.types';

@Component({
    selector: 'app-chat-search-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './chat-search-modal.component.html',
    styleUrl: './chat-search-modal.component.scss'
})
export class ChatSearchModalComponent {
    @Input() open = false;
    @Input() query = '';
    @Input() searching = false;
    @Input() loadingSuggestions = false;
    @Input() error = '';
    @Input() profiles: ReadonlyArray<ProfileDto> = [];
    @Input() followingSuggestions: ReadonlyArray<ProfileDto> = [];
    @Input() relevantSuggestions: ReadonlyArray<ProfileDto> = [];
    @Input() busy = false;

    @Output() close = new EventEmitter<void>();
    @Output() queryChange = new EventEmitter<string>();
    @Output() selectProfile = new EventEmitter<ProfileDto>();

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (this.open && !this.busy) {
            this.close.emit();
        }
    }

    onBackdropClick(event: MouseEvent): void {
        if (this.busy) {
            return;
        }

        if (event.target === event.currentTarget) {
            this.close.emit();
        }
    }

    avatarText(profile: ProfileDto): string {
        const source = profile.displayName?.trim() || profile.handle?.trim();
        return source ? source[0].toUpperCase() : 'U';
    }

    onQueryInput(value: string): void {
        this.queryChange.emit(value);
    }

    get showingSearchResults(): boolean {
        return !!this.query.trim();
    }

    get hasSuggestions(): boolean {
        return this.followingSuggestions.length > 0 || this.relevantSuggestions.length > 0;
    }
}
