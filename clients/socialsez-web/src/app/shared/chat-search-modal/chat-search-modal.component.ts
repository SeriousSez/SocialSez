import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileDto } from '../../core/api.types';

@Component({
    selector: 'app-chat-search-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './chat-search-modal.component.html',
    styleUrl: './chat-search-modal.component.scss'
})
export class ChatSearchModalComponent implements OnChanges {
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
    @Output() startChat = new EventEmitter<ProfileDto[]>();

    private readonly selectedProfileIds = new Set<string>();

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['open']?.currentValue === true && !changes['open']?.previousValue) {
            this.selectedProfileIds.clear();
        }
    }

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

    toggleProfileSelection(profile: ProfileDto): void {
        if (this.busy || !profile.id) {
            return;
        }

        if (this.selectedProfileIds.has(profile.id)) {
            this.selectedProfileIds.delete(profile.id);
            return;
        }

        this.selectedProfileIds.add(profile.id);
    }

    isSelected(profile: ProfileDto): boolean {
        return !!profile.id && this.selectedProfileIds.has(profile.id);
    }

    submitSelection(): void {
        if (!this.canSubmitSelection) {
            return;
        }

        this.startChat.emit(this.selectedProfiles);
    }

    get selectedCount(): number {
        return this.selectedProfiles.length;
    }

    get canSubmitSelection(): boolean {
        return !this.busy && this.selectedCount > 0;
    }

    private get selectedProfiles(): ProfileDto[] {
        const profileById = new Map<string, ProfileDto>();
        for (const profile of this.profiles) {
            if (profile.id) {
                profileById.set(profile.id, profile);
            }
        }

        for (const profile of this.followingSuggestions) {
            if (profile.id && !profileById.has(profile.id)) {
                profileById.set(profile.id, profile);
            }
        }

        for (const profile of this.relevantSuggestions) {
            if (profile.id && !profileById.has(profile.id)) {
                profileById.set(profile.id, profile);
            }
        }

        const selected: ProfileDto[] = [];
        for (const profileId of this.selectedProfileIds) {
            const profile = profileById.get(profileId);
            if (profile) {
                selected.push(profile);
            }
        }

        return selected;
    }

    get showingSearchResults(): boolean {
        return !!this.query.trim();
    }

    get hasSuggestions(): boolean {
        return this.followingSuggestions.length > 0 || this.relevantSuggestions.length > 0;
    }
}
