import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SavedCollectionDto } from '../../core/api.types';
import { PendingSaveToCollectionRequest, SessionService } from '../../core/session.service';

@Component({
    selector: 'app-save-to-collection-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './save-to-collection-modal.component.html',
    styleUrl: './save-to-collection-modal.component.scss'
})
export class SaveToCollectionModalComponent implements OnChanges {
    private readonly session = inject(SessionService);

    @Input() request: PendingSaveToCollectionRequest | null = null;
    @Output() closed = new EventEmitter<void>();

    collections: SavedCollectionDto[] = [];
    loading = false;
    saving = false;
    creatingCollection = false;
    newCollectionName = '';

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['request']?.currentValue) {
            this.creatingCollection = false;
            this.newCollectionName = '';
            void this.loadCollectionsAsync();
        }
    }

    get itemLabel(): string {
        if (!this.request) {
            return 'item';
        }

        return this.request.label?.trim() || this.defaultLabelForKind(this.request.kind);
    }

    async saveToAllAsync(): Promise<void> {
        if (!this.request || this.saving) {
            return;
        }

        this.saving = true;
        try {
            await this.session.saveToCollectionAsync(this.request, null);
            this.request.resolve(true);
            this.closed.emit();
        } catch {
            this.session.message = 'Could not save item right now.';
        } finally {
            this.saving = false;
        }
    }

    async saveToCollectionAsync(collectionId: string): Promise<void> {
        if (!this.request || this.saving) {
            return;
        }

        this.saving = true;
        try {
            await this.session.saveToCollectionAsync(this.request, collectionId);
            this.request.resolve(true);
            this.closed.emit();
        } catch {
            this.session.message = 'Could not save to collection right now.';
        } finally {
            this.saving = false;
        }
    }

    async createCollectionAndSaveAsync(): Promise<void> {
        const name = this.newCollectionName.trim();
        if (!this.request || this.saving || !name) {
            return;
        }

        this.saving = true;
        try {
            const collection = await this.session.createCollectionAsync(name);
            this.collections = [...this.collections, collection];
            await this.session.saveToCollectionAsync(this.request, collection.id);
            this.request.resolve(true);
            this.closed.emit();
        } catch {
            this.session.message = 'Could not create collection right now.';
        } finally {
            this.saving = false;
        }
    }

    cancel(): void {
        if (!this.request || this.saving) {
            return;
        }

        this.request.resolve(false);
        this.closed.emit();
    }

    private async loadCollectionsAsync(): Promise<void> {
        this.loading = true;
        try {
            this.collections = await this.session.loadCollectionsAsync();
        } catch {
            this.collections = [];
            this.session.message = 'Failed to load collections.';
        } finally {
            this.loading = false;
        }
    }

    private defaultLabelForKind(kind: PendingSaveToCollectionRequest['kind']): string {
        switch (kind) {
            case 'post':
                return 'post';
            case 'reel':
                return 'reel';
            case 'community-post':
                return 'community post';
            case 'blog-post':
                return 'blog post';
            default:
                return 'item';
        }
    }
}
