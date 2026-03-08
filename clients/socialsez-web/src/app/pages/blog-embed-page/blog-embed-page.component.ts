import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BlogDto, BlogPostDto } from '../../core/api.types';
import { renderMarkdownToHtml } from '../../core/markdown.util';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-blog-embed-page',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './blog-embed-page.component.html',
    styleUrl: './blog-embed-page.component.scss'
})
export class BlogEmbedPageComponent {
    loading = true;
    error = '';

    handle = '';
    blogSlug = '';
    postSlug = '';

    blog: BlogDto | null = null;
    post: BlogPostDto | null = null;

    private loadVersion = 0;
    private resizeObserver: ResizeObserver | null = null;
    private readonly onWindowResize = (): void => this.notifyHostHeight();

    constructor(
        private readonly route: ActivatedRoute,
        private readonly session: SessionService,
        private readonly cdr: ChangeDetectorRef
    ) {
        this.route.paramMap.subscribe(paramMap => {
            this.handle = (paramMap.get('handle') ?? '').trim().toLowerCase();
            this.blogSlug = (paramMap.get('blogSlug') ?? '').trim().toLowerCase();
            this.postSlug = (paramMap.get('postSlug') ?? '').trim().toLowerCase();
            void this.loadAsync();
        });
    }

    ngAfterViewInit(): void {
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.onWindowResize);
        }

        if (typeof ResizeObserver !== 'undefined' && typeof document !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.notifyHostHeight());
            const embedRoot = this.getEmbedRootElement();
            this.resizeObserver.observe(embedRoot ?? document.body);
        }

        this.notifyHostHeightSoon();
    }

    ngOnDestroy(): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.onWindowResize);
        }

        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    get postUrl(): string {
        const item = this.post;
        if (!item) {
            return '/';
        }

        return `/blogs/${encodeURIComponent(item.authorHandle)}/${encodeURIComponent(item.blogSlug)}/${encodeURIComponent(item.slug)}`;
    }

    get renderedPreviewHtml(): string {
        const post = this.post;
        if (!post) {
            return '';
        }

        const source = (post.excerpt ?? '').trim() || post.content;
        const preview = source.length > 900 ? `${source.slice(0, 900).trimEnd()}...` : source;
        return renderMarkdownToHtml(preview);
    }

    async loadAsync(): Promise<void> {
        const loadVersion = ++this.loadVersion;

        if (!this.handle || !this.blogSlug || !this.postSlug) {
            this.error = 'Embed could not be loaded.';
            this.loading = false;
            this.cdr.detectChanges();
            return;
        }

        this.loading = true;
        this.error = '';

        try {
            await this.session.bootstrapAsync();
            const loadedBlog = await this.session.loadBlogByAuthorAndSlugAsync(this.handle, this.blogSlug);
            const loadedPost = await this.session.loadBlogPostAsync(this.handle, this.blogSlug, this.postSlug);
            if (loadVersion !== this.loadVersion) {
                return;
            }

            if (!loadedBlog || !loadedPost) {
                this.error = 'This blog post is unavailable.';
                this.blog = null;
                this.post = null;
                return;
            }

            if (loadedBlog.allowEmbeds === false) {
                this.error = 'Embedding is disabled by the blog owner.';
                this.blog = null;
                this.post = null;
                return;
            }

            this.blog = loadedBlog;
            this.post = loadedPost;
            this.notifyHostHeightSoon();
        } catch {
            if (loadVersion !== this.loadVersion) {
                return;
            }

            this.error = 'Could not load this embed right now.';
            this.blog = null;
            this.post = null;
            this.notifyHostHeightSoon();
        } finally {
            if (loadVersion === this.loadVersion) {
                this.loading = false;
                this.cdr.detectChanges();
                this.notifyHostHeightSoon();
            }
        }
    }

    private notifyHostHeightSoon(): void {
        if (typeof window === 'undefined') {
            return;
        }

        window.requestAnimationFrame(() => {
            this.notifyHostHeight();
            window.setTimeout(() => this.notifyHostHeight(), 60);
            window.setTimeout(() => this.notifyHostHeight(), 180);
        });
    }

    private notifyHostHeight(): void {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return;
        }

        const embedRoot = this.getEmbedRootElement();
        const embedRootHeight = embedRoot
            ? Math.max(embedRoot.scrollHeight, embedRoot.offsetHeight, Math.ceil(embedRoot.getBoundingClientRect().height))
            : 0;

        const root = document.documentElement;
        const body = document.body;
        const fallbackDocumentHeight = Math.max(
            body?.scrollHeight ?? 0,
            body?.offsetHeight ?? 0,
            root?.scrollHeight ?? 0,
            root?.offsetHeight ?? 0,
            root?.clientHeight ?? 0
        );
        const height = embedRootHeight > 0 ? embedRootHeight : fallbackDocumentHeight;

        if (height <= 0) {
            return;
        }

        window.parent?.postMessage(
            {
                type: 'venli-blog-embed:resize',
                height
            },
            '*'
        );
    }

    private getEmbedRootElement(): HTMLElement | null {
        if (typeof document === 'undefined') {
            return null;
        }

        return document.querySelector('.embed-root');
    }
}
