import { CommonModule, NgStyle } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BlogDto, BlogPostDto } from '../../core/api.types';
import { HashtagTextPart, splitHashtagText } from '../../core/hashtag-text.util';
import { renderMarkdownToHtml } from '../../core/markdown.util';
import { SessionService } from '../../core/session.service';
import { buildUnfurlShareUrl } from '../../core/unfurl-link.util';

@Component({
    selector: 'app-blog-post-page',
    standalone: true,
    imports: [CommonModule, RouterLink, NgStyle],
    templateUrl: './blog-post-page.component.html',
    styleUrl: './blog-post-page.component.scss'
})
export class BlogPostPageComponent implements OnDestroy {
    loading = true;
    error = '';

    handle = '';
    blogSlug = '';
    postSlug = '';

    blog: BlogDto | null = null;
    post: BlogPostDto | null = null;
    copiedShareLink = false;
    private loadVersion = 0;
    private customCssStyleEl: HTMLStyleElement | null = null;
    private appliedCustomCss = '';

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

    ngOnDestroy(): void {
        this.applyCustomCss('');
    }

    get themeStyles(): Record<string, string> {
        const theme = this.blog?.theme;
        return {
            '--theme-font-family': theme?.fontFamily ?? 'Georgia, serif',
            '--theme-accent': theme?.accentColor ?? '#ea580c',
            '--theme-background': theme?.backgroundColor ?? '#fff7ed',
            '--theme-background2': theme?.backgroundColor ?? '#fff7ed',
            '--theme-surface': theme?.surfaceColor ?? '#ffffff'
        };
    }

    get customCss(): string {
        return this.blog?.theme?.customCss ?? '';
    }

    get renderedPostContent(): string {
        return renderMarkdownToHtml(this.post?.content);
    }

    get embedToolsUrl(): string {
        if (!this.handle || !this.blogSlug || !this.postSlug || typeof window === 'undefined') {
            return '';
        }

        const encodedHandle = encodeURIComponent(this.handle);
        const encodedBlogSlug = encodeURIComponent(this.blogSlug);
        const encodedPostSlug = encodeURIComponent(this.postSlug);
        return `${window.location.origin}/blogs/${encodedHandle}/${encodedBlogSlug}/${encodedPostSlug}/embed`;
    }

    get postShareUrl(): string {
        if (!this.handle || !this.blogSlug || !this.postSlug || typeof window === 'undefined') {
            return '';
        }

        const encodedHandle = encodeURIComponent(this.handle);
        const encodedBlogSlug = encodeURIComponent(this.blogSlug);
        const encodedPostSlug = encodeURIComponent(this.postSlug);
        return buildUnfurlShareUrl(`/blogs/${encodedHandle}/${encodedBlogSlug}/${encodedPostSlug}`);
    }

    get allowLikes(): boolean {
        return this.blog?.allowLikes !== false;
    }

    get allowComments(): boolean {
        return this.blog?.allowComments !== false;
    }

    get allowShares(): boolean {
        return this.blog?.allowShares !== false;
    }

    get allowEmbeds(): boolean {
        return this.blog?.allowEmbeds !== false;
    }

    splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
        return splitHashtagText(content);
    }

    openEmbedToolsInNewTab(): void {
        const url = this.embedToolsUrl;
        if (!url || typeof window === 'undefined') {
            return;
        }

        window.open(url, '_self', 'noopener,noreferrer');
    }

    async copyShareLinkAsync(): Promise<void> {
        const url = this.postShareUrl;
        if (!url || typeof navigator === 'undefined' || !navigator.clipboard) {
            return;
        }

        try {
            await navigator.clipboard.writeText(url);
            this.copiedShareLink = true;
            window.setTimeout(() => {
                this.copiedShareLink = false;
                this.cdr.detectChanges();
            }, 1800);
            this.cdr.detectChanges();
        } catch {
            this.copiedShareLink = false;
        }
    }

    async loadAsync(): Promise<void> {
        const loadVersion = ++this.loadVersion;

        if (!this.handle || !this.blogSlug || !this.postSlug) {
            this.error = 'Blog post was not found.';
            this.loading = false;
            this.applyCustomCss('');
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
                this.error = 'Blog post was not found or is private.';
                this.blog = null;
                this.post = null;
                this.applyCustomCss('');
                return;
            }

            this.blog = loadedBlog;
            this.post = loadedPost;
            this.applyCustomCss(this.customCss);
        } catch {
            if (loadVersion !== this.loadVersion) {
                return;
            }

            this.error = 'Could not load this blog post right now.';
            this.blog = null;
            this.post = null;
            this.applyCustomCss('');
        } finally {
            if (loadVersion === this.loadVersion) {
                this.loading = false;
                this.cdr.detectChanges();
            }
        }
    }

    private applyCustomCss(css: string): void {
        if (typeof document === 'undefined') {
            return;
        }

        const normalized = (css ?? '').trim();
        if (normalized === this.appliedCustomCss) {
            return;
        }

        if (!normalized) {
            this.customCssStyleEl?.remove();
            this.customCssStyleEl = null;
            this.appliedCustomCss = '';
            return;
        }

        if (!this.customCssStyleEl) {
            this.customCssStyleEl = document.createElement('style');
            this.customCssStyleEl.setAttribute('data-blog-custom-css', 'blog-post-page');
            document.head.appendChild(this.customCssStyleEl);
        }

        this.customCssStyleEl.textContent = normalized;
        this.appliedCustomCss = normalized;
    }
}
