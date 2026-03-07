import { CommonModule, NgStyle } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BlogDto, BlogPostDto } from '../../core/api.types';
import { HashtagTextPart, splitHashtagText } from '../../core/hashtag-text.util';
import { renderMarkdownToHtml } from '../../core/markdown.util';
import { SessionService } from '../../core/session.service';
import { LazyImageComponent } from '../../shared/lazy-image/lazy-image.component';

@Component({
    selector: 'app-blog-post-page',
    standalone: true,
    imports: [CommonModule, RouterLink, NgStyle, LazyImageComponent],
    templateUrl: './blog-post-page.component.html',
    styleUrl: './blog-post-page.component.scss'
})
export class BlogPostPageComponent {
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
        private readonly session: SessionService
    ) {
        this.route.paramMap.subscribe(paramMap => {
            this.handle = (paramMap.get('handle') ?? '').trim().toLowerCase();
            this.blogSlug = (paramMap.get('blogSlug') ?? '').trim().toLowerCase();
            this.postSlug = (paramMap.get('postSlug') ?? '').trim().toLowerCase();
            void this.loadAsync();
        });
    }

    get themeStyles(): Record<string, string> {
        const theme = this.blog?.theme;
        return {
            '--blog-font': theme?.fontFamily ?? 'Georgia, serif',
            '--blog-accent': theme?.accentColor ?? '#ea580c',
            '--blog-bg': theme?.backgroundColor ?? '#fff7ed',
            '--blog-surface': theme?.surfaceColor ?? '#ffffff'
        };
    }

    get customCss(): string {
        return this.blog?.theme?.customCss ?? '';
    }

    get renderedPostContent(): string {
        return renderMarkdownToHtml(this.post?.content);
    }

    splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
        return splitHashtagText(content);
    }

    async loadAsync(): Promise<void> {
        const loadVersion = ++this.loadVersion;

        if (!this.handle || !this.blogSlug || !this.postSlug) {
            this.error = 'Blog post was not found.';
            this.loading = false;
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

            this.blog = loadedBlog;
            this.post = loadedPost;
        } catch {
            if (loadVersion !== this.loadVersion) {
                return;
            }

            this.error = 'Could not load this blog post right now.';
            this.blog = null;
            this.post = null;
        } finally {
            if (loadVersion === this.loadVersion) {
                this.loading = false;
            }
        }
    }
}
