import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SavedCollectionDto } from '../core/api.types';
import { SessionService } from '../core/session.service';

@Component({
    selector: 'app-saved-collections-rail',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './saved-collections-rail.component.html',
    styleUrl: './saved-collections-rail.component.scss'
})
export class SavedCollectionsRailComponent implements OnInit {
    readonly session = inject(SessionService);
    private readonly router = inject(Router);

    collections: SavedCollectionDto[] = [];
    creatingCollection = false;
    newCollectionName = '';
    renamingCollectionId: string | null = null;
    renameValue = '';
    loading = false;

    get activeCollectionId(): string | null {
        return this.router.parseUrl(this.router.url).queryParamMap.get('collectionId');
    }

    async ngOnInit(): Promise<void> {
        await this.reloadCollectionsAsync();

        this.router.events
            .pipe(filter(event => event instanceof NavigationEnd))
            .subscribe(() => {
                if (this.router.url.startsWith('/saved')) {
                    void this.reloadCollectionsAsync();
                }
            });
    }

    async selectAllAsync(): Promise<void> {
        await this.router.navigate(['/saved'], { queryParams: { collectionId: null }, queryParamsHandling: 'merge' });
    }

    async selectCollectionAsync(collectionId: string): Promise<void> {
        await this.router.navigate(['/saved'], { queryParams: { collectionId }, queryParamsHandling: 'merge' });
    }

    async createCollectionAsync(): Promise<void> {
        const name = this.newCollectionName.trim();
        if (!name) {
            return;
        }

        try {
            const created = await this.session.createCollectionAsync(name);
            this.collections = [...this.collections, created];
            this.newCollectionName = '';
            this.creatingCollection = false;
        } catch {
            this.session.message = 'Failed to create collection.';
        }
    }

    startRename(collection: SavedCollectionDto): void {
        this.renamingCollectionId = collection.id;
        this.renameValue = collection.name;
    }

    async confirmRenameAsync(collection: SavedCollectionDto): Promise<void> {
        const name = this.renameValue.trim();
        this.renamingCollectionId = null;

        if (!name || name === collection.name) {
            return;
        }

        try {
            const updated = await this.session.renameCollectionAsync(collection.id, name);
            this.collections = this.collections.map(existing => existing.id === updated.id ? updated : existing);
        } catch {
            this.session.message = 'Failed to rename collection.';
        }
    }

    async deleteCollectionAsync(collection: SavedCollectionDto): Promise<void> {
        if (!confirm(`Delete collection "${collection.name}"? Items will not be removed from your saved items.`)) {
            return;
        }

        try {
            await this.session.deleteCollectionAsync(collection.id);
            this.collections = this.collections.filter(existing => existing.id !== collection.id);

            if (this.activeCollectionId === collection.id) {
                await this.selectAllAsync();
            }
        } catch {
            this.session.message = 'Failed to delete collection.';
        }
    }

    private async reloadCollectionsAsync(): Promise<void> {
        this.loading = true;
        try {
            this.collections = await this.session.loadCollectionsAsync();
        } catch {
            this.session.message = 'Failed to load collections.';
        } finally {
            this.loading = false;
        }
    }
}