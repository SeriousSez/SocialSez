import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ReelDto, SavedCollectionDto, SavedItemDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { PostCardComponent } from '../../shared/post-card/post-card.component';
import { SegmentedTabItem, SegmentedTabsComponent } from '../../shared/segmented-tabs/segmented-tabs.component';

type SavedView = 'all' | { collectionId: string; name: string };

@Component({
    selector: 'app-saved-page',
    standalone: true,
    imports: [CommonModule, FormsModule, PostCardComponent, SegmentedTabsComponent],
    templateUrl: './saved-page.component.html',
    styleUrl: './saved-page.component.scss'
})
export class SavedPageComponent implements OnInit {
    readonly session = inject(SessionService);
    private readonly route = inject(ActivatedRoute);
    private readonly destroyRef = inject(DestroyRef);

    isLoading = true;
    isCreatingCollection = false;
    newCollectionName = '';
    renamingCollectionId: string | null = null;
    renameValue = '';

    collections: SavedCollectionDto[] = [];
    items: SavedItemDto[] = [];
    view: SavedView = 'all';
    activeContentTab: 'posts' | 'reels' | 'community-posts' | 'blog-posts' = 'posts';
    readonly contentTabs: readonly SegmentedTabItem[] = [
        { id: 'posts', label: 'Posts' },
        { id: 'reels', label: 'Reels' },
        { id: 'community-posts', label: 'Community posts' },
        { id: 'blog-posts', label: 'Blog posts' }
    ];

    async ngOnInit(): Promise<void> {
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                void this.loadForViewAsync(params.get('collectionId'));
            });
    }

    private async loadForViewAsync(collectionId: string | null): Promise<void> {
        this.isLoading = true;
        try {
            this.collections = await this.session.loadCollectionsAsync();

            if (collectionId) {
                const matchingCollection = this.collections.find(collection => collection.id === collectionId);

                if (matchingCollection) {
                    this.view = { collectionId: matchingCollection.id, name: matchingCollection.name };
                    this.items = await this.session.loadCollectionItemsAsync(matchingCollection.id, 50, 0);
                } else {
                    this.view = 'all';
                    this.items = await this.session.loadAllSavedItemsAsync(50, 0);
                }
            } else {
                this.view = 'all';
                this.items = await this.session.loadAllSavedItemsAsync(50, 0);
            }
        } catch {
            this.session.message = 'Failed to load saved items.';
        } finally {
            this.isLoading = false;
        }
    }

    async unsaveItem(item: SavedItemDto): Promise<void> {
        try {
            await this.session.unsaveItemAsync(item.id);
            this.items = this.items.filter(i => i.id !== item.id);
        } catch {
            this.session.message = 'Failed to unsave item.';
        }
    }

    async addItemToCollection(item: SavedItemDto, collectionId: string): Promise<void> {
        try {
            await this.session.addToCollectionAsync(collectionId, item.id);
            this.session.message = 'Added to collection.';
        } catch {
            this.session.message = 'Failed to add to collection.';
        }
    }

    get viewTitle(): string {
        if (this.view === 'all') return 'All Saved';
        return this.view.name;
    }

    get filteredItems(): SavedItemDto[] {
        if (this.activeContentTab === 'posts') {
            return this.items.filter(item => item.itemType === 'Post' && !!item.post);
        }

        if (this.activeContentTab === 'reels') {
            return this.items.filter(item => item.itemType === 'Reel' && !!item.reel);
        }

        return [];
    }

    get activeContentLabel(): string {
        if (this.activeContentTab === 'community-posts') {
            return 'community posts';
        }

        if (this.activeContentTab === 'blog-posts') {
            return 'blog posts';
        }

        return this.activeContentTab;
    }

    get isAllView(): boolean {
        return this.view === 'all';
    }

    get viewerProfileId(): string {
        return this.session.profile?.id ?? '';
    }

    onContentTabChanged(tabId: string): void {
        if (tabId === 'posts' || tabId === 'reels' || tabId === 'community-posts' || tabId === 'blog-posts') {
            this.activeContentTab = tabId;
        }
    }

    openReel(reel: ReelDto): void {
        this.session.requestOpenReelInModal(reel);
    }
}
