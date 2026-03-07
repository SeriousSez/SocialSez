import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BlogDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

type BlogsTab = 'all' | 'following' | 'mine';
type BlogSort = 'updated' | 'created' | 'title';

@Component({
    selector: 'app-blogs-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './blogs-page.component.html',
    styleUrl: './blogs-page.component.scss'
})
export class BlogsPageComponent {
    readonly tabs: ReadonlyArray<{ key: BlogsTab; label: string }> = [
        { key: 'all', label: 'All blogs' },
        { key: 'following', label: 'Following' },
        { key: 'mine', label: 'My blogs' }
    ];

    activeTab: BlogsTab = 'all';
    sortBy: BlogSort = 'updated';
    searchText = '';
    loading = true;
    error = '';
    blogs: BlogDto[] = [];
    readonly pageSize = 18;
    visibleCount = 18;
    loadingMore = false;

    @ViewChild('infiniteSentinel')
    set infiniteSentinel(value: ElementRef<HTMLDivElement> | undefined) {
        this.sentinelRef = value;
        this.refreshInfiniteObserver();
    }

    private sentinelRef?: ElementRef<HTMLDivElement>;
    private infiniteObserver: IntersectionObserver | null = null;

    constructor(public readonly session: SessionService) {
        void this.loadAsync();
    }

    async selectTabAsync(tab: BlogsTab): Promise<void> {
        if (this.activeTab === tab) {
            return;
        }

        this.activeTab = tab;
        this.resetPagination();
        await this.loadAsync();
    }

    async runSearchAsync(): Promise<void> {
        this.resetPagination();
        await this.loadAsync();
    }

    async clearSearchAsync(): Promise<void> {
        if (!this.searchText.trim()) {
            return;
        }

        this.searchText = '';
        this.resetPagination();
        await this.loadAsync();
    }

    onSortChanged(): void {
        this.resetPagination();
        this.scheduleObserverRefresh();
    }

    loadMoreBlogs(): void {
        if (!this.hasMoreBlogs) {
            return;
        }

        this.visibleCount += this.pageSize;
        this.scheduleObserverRefresh();
    }

    async loadAsync(): Promise<void> {
        this.loading = true;
        this.error = '';

        try {
            await this.session.bootstrapAsync();

            const query = this.searchText.trim();
            let loadedBlogs: BlogDto[] = [];

            if (this.activeTab === 'all') {
                loadedBlogs = await this.session.discoverBlogsAsync(query || undefined, 80);
            } else if (!this.session.isAuthenticated()) {
                loadedBlogs = [];
                this.error = 'Sign in to view this tab.';
            } else if (this.activeTab === 'following') {
                loadedBlogs = await this.session.loadFollowingBlogsAsync(query || undefined, 80);
            } else {
                loadedBlogs = await this.session.loadMyBlogsAsync();
                if (query) {
                    const q = query.toLowerCase();
                    loadedBlogs = loadedBlogs.filter(blog =>
                        blog.title.toLowerCase().includes(q)
                        || (blog.description ?? '').toLowerCase().includes(q)
                        || blog.slug.toLowerCase().includes(q)
                        || blog.ownerHandle.toLowerCase().includes(q));
                }
            }

            this.blogs = loadedBlogs;
        } catch {
            this.blogs = [];
            this.error = 'Could not load blogs right now.';
        } finally {
            this.loading = false;
            this.scheduleObserverRefresh();
        }
    }

    trackBlog(_: number, blog: BlogDto): string {
        return blog.id;
    }

    get tabSubtitle(): string {
        switch (this.activeTab) {
            case 'following':
                return 'Blogs from creators you follow.';
            case 'mine':
                return 'Manage your own blogs and drafts.';
            default:
                return 'Discover and search blogs across Venli.';
        }
    }

    get sortedBlogs(): BlogDto[] {
        const blogs = [...this.blogs];
        switch (this.sortBy) {
            case 'created':
                return blogs.sort((a, b) => this.toTimestamp(b.createdAtUtc) - this.toTimestamp(a.createdAtUtc));
            case 'title':
                return blogs.sort((a, b) => a.title.localeCompare(b.title));
            default:
                return blogs.sort((a, b) => this.toTimestamp(b.updatedAtUtc) - this.toTimestamp(a.updatedAtUtc));
        }
    }

    get visibleBlogs(): BlogDto[] {
        return this.sortedBlogs.slice(0, this.visibleCount);
    }

    get hasMoreBlogs(): boolean {
        return this.visibleBlogs.length < this.sortedBlogs.length;
    }

    private resetPagination(): void {
        this.visibleCount = this.pageSize;
    }

    ngAfterViewInit(): void {
        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
            return;
        }

        this.infiniteObserver = new IntersectionObserver(
            entries => {
                if (!entries.some(entry => entry.isIntersecting) || this.loadingMore || this.loading || !this.hasMoreBlogs) {
                    return;
                }

                this.loadingMore = true;
                this.loadMoreBlogs();
                this.loadingMore = false;
            },
            {
                root: null,
                rootMargin: '220px 0px',
                threshold: 0
            }
        );

        this.refreshInfiniteObserver();
    }

    ngOnDestroy(): void {
        if (this.infiniteObserver) {
            this.infiniteObserver.disconnect();
        }
    }

    private refreshInfiniteObserver(): void {
        if (!this.infiniteObserver) {
            return;
        }

        this.infiniteObserver.disconnect();

        const sentinel = this.sentinelRef?.nativeElement;
        if (!sentinel || !this.hasMoreBlogs || this.loading || !!this.error) {
            return;
        }

        this.infiniteObserver.observe(sentinel);
    }

    private scheduleObserverRefresh(): void {
        setTimeout(() => this.refreshInfiniteObserver(), 0);
    }

    private toTimestamp(value: string): number {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
}
