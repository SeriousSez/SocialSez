import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { BlogDto, BlogPostDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-blog-embed-tools-page',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './blog-embed-tools-page.component.html',
    styleUrl: './blog-embed-tools-page.component.scss'
})
export class BlogEmbedToolsPageComponent {
    loading = true;
    error = '';

    handle = '';
    blogSlug = '';
    postSlug = '';

    blog: BlogDto | null = null;
    post: BlogPostDto | null = null;
    copiedEmbedCode = false;
    @ViewChild('embedPreviewFrame') embedPreviewFrame?: ElementRef<HTMLIFrameElement>;

    private loadVersion = 0;
    private cachedSafeEmbedUrlSource = '';
    private cachedSafeEmbedUrl: SafeResourceUrl | null = null;
    private readonly onEmbedMessage = (event: MessageEvent): void => {
        const frame = this.embedPreviewFrame?.nativeElement;
        if (!frame || event.source !== frame.contentWindow) {
            return;
        }

        const data = event.data as { type?: string; height?: unknown } | null;
        if (!data || data.type !== 'venli-blog-embed:resize') {
            return;
        }

        const height = Number(data.height);
        if (!Number.isFinite(height) || height <= 0) {
            return;
        }

        frame.style.height = `${Math.max(220, Math.ceil(height))}px`;
    };

    constructor(
        private readonly route: ActivatedRoute,
        private readonly session: SessionService,
        private readonly cdr: ChangeDetectorRef,
        private readonly sanitizer: DomSanitizer
    ) {
        if (typeof window !== 'undefined') {
            window.addEventListener('message', this.onEmbedMessage, false);
        }

        this.route.paramMap.subscribe(paramMap => {
            this.handle = (paramMap.get('handle') ?? '').trim().toLowerCase();
            this.blogSlug = (paramMap.get('blogSlug') ?? '').trim().toLowerCase();
            this.postSlug = (paramMap.get('postSlug') ?? '').trim().toLowerCase();
            void this.loadAsync();
        });
    }

    ngOnDestroy(): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener('message', this.onEmbedMessage, false);
        }
    }

    get embedUrl(): string {
        if (!this.handle || !this.blogSlug || !this.postSlug || typeof window === 'undefined') {
            return '';
        }

        const encodedHandle = encodeURIComponent(this.handle);
        const encodedBlogSlug = encodeURIComponent(this.blogSlug);
        const encodedPostSlug = encodeURIComponent(this.postSlug);
        return `${window.location.origin}/embed/blogs/${encodedHandle}/${encodedBlogSlug}/${encodedPostSlug}`;
    }

    get postUrl(): string {
        if (!this.handle || !this.blogSlug || !this.postSlug) {
            return '/blogs';
        }

        return `/blogs/${encodeURIComponent(this.handle)}/${encodeURIComponent(this.blogSlug)}/${encodeURIComponent(this.postSlug)}`;
    }

    get safeEmbedUrl(): SafeResourceUrl | null {
        const src = this.embedUrl;
        if (!src) {
            this.cachedSafeEmbedUrlSource = '';
            this.cachedSafeEmbedUrl = null;
            return null;
        }

        if (src !== this.cachedSafeEmbedUrlSource || this.cachedSafeEmbedUrl === null) {
            this.cachedSafeEmbedUrlSource = src;
            this.cachedSafeEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(src);
        }

        return this.cachedSafeEmbedUrl;
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

    get embedIframeCode(): string {
        const src = this.embedUrl;
        if (!src) {
            return '';
        }

        const safeTitle = this.post?.title?.trim() || 'Venli blog embed';
        const escapedTitle = safeTitle.replace(/"/g, '&quot;');
        return `<iframe src="${src}" width="100%" style="display:block;border:0;overflow:hidden;border-radius:12px;height:320px;" loading="lazy" title="${escapedTitle}"></iframe>\n<script>(function(){var iframe=document.currentScript&&document.currentScript.previousElementSibling;if(!iframe||iframe.tagName!=='IFRAME'){return;}function onMessage(event){if(event.source!==iframe.contentWindow){return;}var data=event.data||{};if(data.type!=='venli-blog-embed:resize'){return;}var h=Number(data.height);if(!Number.isFinite(h)||h<=0){return;}iframe.style.height=Math.max(220,Math.ceil(h))+'px';}window.addEventListener('message',onMessage,false);})();</script>`;
    }

    async copyEmbedCodeAsync(): Promise<void> {
        const code = this.embedIframeCode;
        if (!code || typeof navigator === 'undefined' || !navigator.clipboard) {
            return;
        }

        try {
            await navigator.clipboard.writeText(code);
            this.copiedEmbedCode = true;
            window.setTimeout(() => {
                this.copiedEmbedCode = false;
                this.cdr.detectChanges();
            }, 1800);
            this.cdr.detectChanges();
        } catch {
            this.copiedEmbedCode = false;
        }
    }

    private async loadAsync(): Promise<void> {
        const loadVersion = ++this.loadVersion;

        if (!this.handle || !this.blogSlug || !this.postSlug) {
            this.error = 'Blog post was not found.';
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
                this.error = 'Blog post was not found or is private.';
                this.blog = null;
                this.post = null;
                return;
            }

            if (loadedBlog.allowEmbeds === false) {
                this.error = 'Embedding is disabled by the blog owner.';
                this.blog = loadedBlog;
                this.post = null;
                return;
            }

            this.blog = loadedBlog;
            this.post = loadedPost;
        } catch {
            if (loadVersion !== this.loadVersion) {
                return;
            }

            this.error = 'Could not load embed tools for this post right now.';
            this.blog = null;
            this.post = null;
        } finally {
            if (loadVersion === this.loadVersion) {
                this.loading = false;
                this.cdr.detectChanges();
            }
        }
    }
}
