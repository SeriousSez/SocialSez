import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BlogDto } from '../../core/api.types';
import { buildDiscoverySuggestions, DISCOVERY_TOPICS, rankByDiscoveryQuery, scoreDiscoveryFields } from '../../core/discovery-search.util';
import { SessionService } from '../../core/session.service';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { TranslateContentComponent } from '../../shared/translate-content/translate-content.component';

type BlogsTab = 'all' | 'following' | 'mine';
type BlogSort = 'updated' | 'created' | 'title';

@Component({
    selector: 'app-blogs-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, SkeletonComponent, TranslateContentComponent],
    templateUrl: './blogs-page.component.html',
    styleUrl: './blogs-page.component.scss'
})
export class BlogsPageComponent {
    get tabs(): ReadonlyArray<{ key: BlogsTab; label: string }> {
        return [
            { key: 'all', label: this.t('blogs.tabs.all') },
            { key: 'following', label: this.t('blogs.tabs.following') },
            { key: 'mine', label: this.t('blogs.tabs.mine') }
        ];
    }

    activeTab: BlogsTab = 'all';
    sortBy: BlogSort = 'updated';
    searchText = '';
    loading = true;
    sortMenuOpen = false;
    error = '';
    blogs: BlogDto[] = [];
    readonly pageSize = 18;
    visibleCount = 18;
    loadingMore = false;
    suggestions: string[] = [];
    private readonly suggestionSeed = new Set<string>(DISCOVERY_TOPICS.map(topic => topic.canonical));
    private queryDebounceTimerId: number | null = null;
    private readonly translate = inject(TranslateService);

    @ViewChild('infiniteSentinel')
    set infiniteSentinel(value: ElementRef<HTMLDivElement> | undefined) {
        this.sentinelRef = value;
        this.refreshInfiniteObserver();
    }

    private sentinelRef?: ElementRef<HTMLDivElement>;
    private infiniteObserver: IntersectionObserver | null = null;

    get sortOptions(): ReadonlyArray<{ value: BlogSort; label: string }> {
        return [
            { value: 'updated', label: this.t('blogs.sort.recentlyUpdated') },
            { value: 'created', label: this.t('blogs.sort.newestCreated') },
            { value: 'title', label: this.t('blogs.sort.titleAz') }
        ];
    }

    constructor(
        public readonly session: SessionService,
        private readonly ngZone: NgZone,
        private readonly router: Router
    ) {
        void this.loadAsync();
    }

    async openBlogAsync(blog: BlogDto, event?: Event): Promise<void> {
        if (event) {
            const target = event.target as HTMLElement | null;
            if (target?.closest('a,button,input,textarea,select,label')) {
                return;
            }
        }

        await this.router.navigate(['/blogs', blog.ownerHandle, blog.slug]);
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

    onSearchInput(): void {
        if (this.queryDebounceTimerId !== null) {
            window.clearTimeout(this.queryDebounceTimerId);
            this.queryDebounceTimerId = null;
        }

        this.queryDebounceTimerId = window.setTimeout(() => {
            this.queryDebounceTimerId = null;
            this.ngZone.run(() => {
                void this.runSearchAsync();
            });
        }, 220);

        this.refreshSuggestions();
    }

    async clearSearchAsync(): Promise<void> {
        if (!this.searchText.trim()) {
            return;
        }

        this.searchText = '';
        this.refreshSuggestions();
        this.resetPagination();
        await this.loadAsync();
    }

    async applySuggestionAsync(suggestion: string): Promise<void> {
        const next = suggestion.trim();
        if (!next) {
            return;
        }

        this.searchText = next;
        this.refreshSuggestions();
        this.resetPagination();
        await this.loadAsync();
    }

    onSortChanged(): void {
        this.resetPagination();
        this.scheduleObserverRefresh();
    }

    toggleSortMenu(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.sortMenuOpen = !this.sortMenuOpen;
    }

    selectSort(value: BlogSort, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.sortBy !== value) {
            this.sortBy = value;
            this.onSortChanged();
        }

        this.sortMenuOpen = false;
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
            const backendQuery = query || undefined;
            let loadedBlogs: BlogDto[] = [];

            if (this.activeTab === 'all') {
                loadedBlogs = await this.session.discoverBlogsAsync(backendQuery, 120);
            } else if (!this.session.isAuthenticated()) {
                loadedBlogs = [];
                this.error = this.t('blogs.errors.signInToViewTab');
            } else if (this.activeTab === 'following') {
                loadedBlogs = await this.session.loadFollowingBlogsAsync(backendQuery, 120);
            } else {
                loadedBlogs = await this.session.loadMyBlogsAsync();
            }

            this.rememberSuggestionSeed(loadedBlogs);
            this.blogs = this.rankAndFilterBlogs(loadedBlogs, query);
            this.refreshSuggestions();
        } catch {
            this.blogs = [];
            this.error = this.t('blogs.errors.loadNow');
        } finally {
            this.loading = false;
            this.scheduleObserverRefresh();
        }
    }

    trackBlog(_: number, blog: BlogDto): string {
        return blog.id;
    }

    blogCardStyles(blog: BlogDto): Record<string, string> {
        return {
            '--blog-card-accent': this.normalizeBlogAccent(blog.theme?.accentColor)
        };
    }

    get tabSubtitle(): string {
        switch (this.activeTab) {
            case 'following':
                return this.t('blogs.subtitle.following');
            case 'mine':
                return this.t('blogs.subtitle.mine');
            default:
                return this.t('blogs.subtitle.all');
        }
    }

    get currentSortLabel(): string {
        return this.sortOptions.find(option => option.value === this.sortBy)?.label ?? this.t('blogs.sort.recentlyUpdated');
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
                this.ngZone.run(() => {
                    if (!entries.some(entry => entry.isIntersecting) || this.loadingMore || this.loading || !this.hasMoreBlogs) {
                        return;
                    }

                    this.loadingMore = true;
                    this.loadMoreBlogs();
                    this.loadingMore = false;
                });
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
        if (this.queryDebounceTimerId !== null) {
            window.clearTimeout(this.queryDebounceTimerId);
            this.queryDebounceTimerId = null;
        }

        if (this.infiniteObserver) {
            this.infiniteObserver.disconnect();
        }
    }

    @HostListener('document:click')
    onDocumentClick(): void {
        this.sortMenuOpen = false;
    }

    @HostListener('document:keydown.escape')
    onDocumentEscape(): void {
        this.sortMenuOpen = false;
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
        window.setTimeout(() => {
            this.ngZone.run(() => {
                this.refreshInfiniteObserver();
            });
        }, 0);
    }

    private toTimestamp(value: string): number {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    private normalizeBlogAccent(value: string | null | undefined): string {
        const normalized = (value ?? '').trim();
        if (!normalized) {
            return '#0ea5e9';
        }

        if (/^[0-9a-fA-F]{3,8}$/.test(normalized)) {
            return `#${normalized}`;
        }

        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(normalized)) {
            return normalized;
        }

        if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', normalized)) {
            return normalized;
        }

        return '#0ea5e9';
    }

    private rankAndFilterBlogs(blogs: ReadonlyArray<BlogDto>, query: string): BlogDto[] {
        return rankByDiscoveryQuery(blogs, {
            query,
            minScore: 0,
            score: (blog, expandedTerms) => this.blogSearchScore(blog, expandedTerms),
            onEmptyQuery: items => [...items],
            tieBreaker: (left, right) => this.toTimestamp(right.updatedAtUtc) - this.toTimestamp(left.updatedAtUtc)
        });
    }

    private blogSearchScore(blog: BlogDto, expandedTerms: ReadonlyArray<string>): number {
        return scoreDiscoveryFields(expandedTerms, [
            { value: blog.title, weight: 1.7 },
            { value: blog.slug, weight: 1.2 },
            { value: blog.ownerHandle, weight: 1.0 },
            { value: blog.description ?? '', weight: 1.3 }
        ]);
    }

    private rememberSuggestionSeed(blogs: ReadonlyArray<BlogDto>): void {
        for (const blog of blogs.slice(0, 64)) {
            this.addSeed(blog.slug);
            this.addSeed(blog.ownerHandle);

            for (const token of blog.title.split(/[^\p{L}\p{N}_-]+/u)) {
                this.addSeed(token);
            }

            const description = blog.description ?? '';
            for (const token of description.split(/[^\p{L}\p{N}_-]+/u)) {
                this.addSeed(token);
            }
        }
    }

    private addSeed(value: string): void {
        const token = value.trim().toLowerCase();
        if (token.length < 3 || token.length > 32) {
            return;
        }

        this.suggestionSeed.add(token);
    }

    private refreshSuggestions(): void {
        this.suggestions = buildDiscoverySuggestions(this.searchText, Array.from(this.suggestionSeed), 8);
    }

    private t(key: string, params?: Record<string, unknown>): string {
        return this.translate.instant(key, params);
    }
}
