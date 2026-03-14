import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BlogPostDto, CommunityPostDto, ReelDto, SavedCollectionDto, SavedItemDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { SegmentedTabItem, SegmentedTabsComponent } from '../../shared/segmented-tabs/segmented-tabs.component';

type SavedView = 'all' | { collectionId: string; name: string };

interface SavedPostContentPart {
    text: string;
    hashtag?: string;
    mentionHandle?: string;
}

@Component({
    selector: 'app-saved-page',
    standalone: true,
    imports: [CommonModule, RouterLink, SegmentedTabsComponent],
    templateUrl: './saved-page.component.html',
    styleUrl: './saved-page.component.scss'
})
export class SavedPageComponent implements OnInit {
    readonly session = inject(SessionService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    isLoading = true;
    isCreatingCollection = false;
    newCollectionName = '';
    renamingCollectionId: string | null = null;
    renameValue = '';

    collections: SavedCollectionDto[] = [];
    items: SavedItemDto[] = [];
    communityPosts: CommunityPostDto[] = [];
    blogPosts: BlogPostDto[] = [];
    view: SavedView = 'all';
    collectionMenuOpen = false;
    activeContentTab: 'posts' | 'reels' | 'community-posts' | 'blog-posts' = 'posts';
    readonly contentTabs: readonly SegmentedTabItem[] = [
        { id: 'posts', label: 'Posts' },
        { id: 'reels', label: 'Reels' },
        { id: 'community-posts', label: 'Community posts' },
        { id: 'blog-posts', label: 'Blog posts' }
    ];

    get selectedCollectionOption(): string {
        return this.view === 'all' ? 'all' : this.view.collectionId;
    }

    get selectedCollectionLabel(): string {
        if (this.view === 'all') {
            return 'All Saved';
        }

        return `${this.view.name}`;
    }

    async ngOnInit(): Promise<void> {
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                void this.loadForViewAsync(params.get('collectionId'));
            });
    }

    private async loadForViewAsync(collectionId: string | null): Promise<void> {
        this.isLoading = true;
        this.collectionMenuOpen = false;
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

            if (this.activeContentTab === 'community-posts') {
                await this.loadSavedCommunityPostsAsync();
            }

            if (this.activeContentTab === 'blog-posts') {
                await this.loadSavedBlogPostsAsync();
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

    get filteredCommunityPosts(): CommunityPostDto[] {
        if (!this.isAllView) {
            return this.items
                .filter(item => item.itemType === 'CommunityPost' && !!item.communityPost)
                .map(item => item.communityPost!);
        }

        return this.communityPosts;
    }

    get filteredBlogPosts(): BlogPostDto[] {
        if (!this.isAllView) {
            return this.items
                .filter(item => item.itemType === 'BlogPost' && !!item.blogPost)
                .map(item => item.blogPost!);
        }

        return this.blogPosts;
    }

    get activeCount(): number {
        if (this.activeContentTab === 'community-posts') {
            return this.filteredCommunityPosts.length;
        }

        if (this.activeContentTab === 'blog-posts') {
            return this.filteredBlogPosts.length;
        }

        return this.filteredItems.length;
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

    toggleCollectionMenu(): void {
        this.collectionMenuOpen = !this.collectionMenuOpen;
    }

    async chooseCollectionOption(selection: string): Promise<void> {
        this.collectionMenuOpen = false;
        await this.onCollectionSelectionChanged(selection);
    }

    closeCollectionMenu(): void {
        this.collectionMenuOpen = false;
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        if (!this.collectionMenuOpen) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        if (!target.closest('.collection-dropdown')) {
            this.collectionMenuOpen = false;
        }
    }

    @HostListener('document:keydown.escape')
    onEscapePressed(): void {
        this.collectionMenuOpen = false;
    }

    async onCollectionSelectionChanged(selection: string): Promise<void> {
        if (selection === 'all') {
            await this.router.navigate(['/saved'], {
                queryParams: { collectionId: null },
                queryParamsHandling: 'merge'
            });
            return;
        }

        await this.router.navigate(['/saved'], {
            queryParams: { collectionId: selection },
            queryParamsHandling: 'merge'
        });
    }

    onContentTabChanged(tabId: string): void {
        if (tabId === 'posts' || tabId === 'reels' || tabId === 'community-posts' || tabId === 'blog-posts') {
            this.activeContentTab = tabId;
            if (tabId === 'community-posts' && this.communityPosts.length === 0) {
                void this.loadSavedCommunityPostsAsync();
            }

            if (tabId === 'blog-posts' && this.blogPosts.length === 0) {
                void this.loadSavedBlogPostsAsync();
            }
        }
    }

    async unsaveCommunityPost(post: CommunityPostDto): Promise<void> {
        try {
            await this.session.unsaveCommunityPostAsync(post.communityId, post.id);
            this.communityPosts = this.communityPosts.filter(item => item.id !== post.id);
        } catch {
            this.session.message = 'Failed to unsave post.';
        }
    }

    async unsaveBlogPost(post: BlogPostDto): Promise<void> {
        try {
            await this.session.unsaveBlogPostAsync(post.blogId, post.id);
            this.blogPosts = this.blogPosts.filter(item => item.id !== post.id);
        } catch {
            this.session.message = 'Failed to unsave post.';
        }
    }

    openReel(item: SavedItemDto): void {
        if (!item.reel) {
            return;
        }

        if (this.view === 'all') {
            this.session.requestOpenReelInModal({ reel: item.reel });
            return;
        }

        const { collectionId } = this.view;
        this.session.requestOpenReelInModal({
            reel: item.reel,
            collectionId,
            savedItemId: item.id,
            onRemoveFromCollection: () => this.removeReelFromCollectionAsync(item.id, collectionId)
        });
    }

    private async removeReelFromCollectionAsync(savedItemId: string, collectionId: string): Promise<boolean> {
        try {
            await this.session.removeFromCollectionAsync(collectionId, savedItemId);
            this.items = this.items.filter(item => item.id !== savedItemId);

            const collectionStillHasItems = await this.collectionHasItemsAsync(collectionId);
            if (!collectionStillHasItems) {
                await this.session.deleteCollectionAsync(collectionId);
                this.view = 'all';
                await this.router.navigate(['/saved'], {
                    queryParams: { collectionId: null },
                    queryParamsHandling: 'merge'
                });
                this.session.message = 'Collection deleted because it became empty.';
                return true;
            }

            this.session.message = 'Removed from collection.';
            return true;
        } catch {
            this.session.message = 'Failed to remove from collection.';
            return false;
        }
    }

    private async collectionHasItemsAsync(collectionId: string): Promise<boolean> {
        const remaining = await this.session.loadCollectionItemsAsync(collectionId, 1, 0);
        return remaining.length > 0;
    }

    postContentLines(content: string): SavedPostContentPart[][] {
        return content
            .split(/\r?\n/)
            .map(line => this.parseLineParts(line));
    }

    private parseLineParts(line: string): SavedPostContentPart[] {
        const tokenRegex = /#[\p{L}\p{N}_]+|\B@[\p{L}\p{N}_]+/gu;
        const parts: SavedPostContentPart[] = [];
        let cursor = 0;

        for (const match of line.matchAll(tokenRegex)) {
            const token = match[0] ?? '';
            const start = match.index ?? -1;

            if (start < 0) {
                continue;
            }

            if (start > cursor) {
                parts.push({ text: line.slice(cursor, start) });
            }

            if (token.startsWith('#')) {
                parts.push({ text: token, hashtag: token.slice(1) });
            } else {
                parts.push({ text: token, mentionHandle: token.slice(1) });
            }

            cursor = start + token.length;
        }

        if (cursor < line.length) {
            parts.push({ text: line.slice(cursor) });
        }

        if (!parts.length) {
            parts.push({ text: '' });
        }

        return parts;
    }

    private async loadSavedCommunityPostsAsync(): Promise<void> {
        if (!this.isAllView) {
            this.communityPosts = [];
            return;
        }

        this.isLoading = true;
        try {
            this.communityPosts = await this.session.loadSavedCommunityPostsAsync(50, 0);
        } catch {
            this.session.message = 'Failed to load saved community posts.';
        } finally {
            this.isLoading = false;
        }
    }

    private async loadSavedBlogPostsAsync(): Promise<void> {
        if (!this.isAllView) {
            this.blogPosts = [];
            return;
        }

        this.isLoading = true;
        try {
            this.blogPosts = await this.session.loadSavedBlogPostsAsync(50, 0);
        } catch {
            this.session.message = 'Failed to load saved blog posts.';
        } finally {
            this.isLoading = false;
        }
    }
}
