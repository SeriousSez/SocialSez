import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
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
        } catch {
            if (loadVersion !== this.loadVersion) {
                return;
            }

            this.error = 'Could not load this embed right now.';
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
