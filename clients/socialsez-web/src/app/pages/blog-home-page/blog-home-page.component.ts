import { CommonModule, NgStyle } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BlogDto, BlogPostDto } from '../../core/api.types';
import { HashtagTextPart, splitHashtagText } from '../../core/hashtag-text.util';
import { SessionService } from '../../core/session.service';
import { LazyImageComponent } from '../../shared/lazy-image/lazy-image.component';

@Component({
    selector: 'app-blog-home-page',
    standalone: true,
    imports: [CommonModule, RouterLink, NgStyle, LazyImageComponent],
    templateUrl: './blog-home-page.component.html',
    styleUrl: './blog-home-page.component.scss'
})
export class BlogHomePageComponent {
    loading = true;
    error = '';
    handle = '';
    blogSlug = '';
    blog: BlogDto | null = null;
    posts: BlogPostDto[] = [];
    private loadVersion = 0;

    constructor(
        private readonly route: ActivatedRoute,
        private readonly session: SessionService,
        private readonly router: Router
    ) {
        this.route.paramMap.subscribe(paramMap => {
            this.handle = (paramMap.get('handle') ?? '').trim().toLowerCase();
            this.blogSlug = (paramMap.get('blogSlug') ?? '').trim().toLowerCase();
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

    get postLayoutClass(): string {
        return this.blog?.theme?.postListLayout?.toLowerCase() === 'grid' ? 'grid' : 'stack';
    }

    get headerLayoutClass(): string {
        return this.blog?.theme?.headerLayout?.toLowerCase() === 'center' ? 'center' : 'left';
    }

    async loadAsync(): Promise<void> {
        const loadVersion = ++this.loadVersion;

        if (!this.handle || !this.blogSlug) {
            this.error = 'Blog was not found.';
            this.loading = false;
            return;
        }

        this.loading = true;
        this.error = '';

        try {
            await this.session.bootstrapAsync();
            const loadedBlog = await this.session.loadBlogByAuthorAndSlugAsync(this.handle, this.blogSlug);
            if (loadVersion !== this.loadVersion) {
                return;
            }

            if (!loadedBlog) {
                this.error = 'Blog was not found or is private.';
                this.blog = null;
                this.posts = [];
                return;
            }

            this.blog = loadedBlog;
            this.posts = await this.session.loadBlogPostsAsync(this.handle, this.blogSlug);
            if (loadVersion !== this.loadVersion) {
                return;
            }
        } catch {
            if (loadVersion !== this.loadVersion) {
                return;
            }

            this.error = 'Could not load this blog right now.';
            this.blog = null;
            this.posts = [];
        } finally {
            if (loadVersion === this.loadVersion) {
                this.loading = false;
            }
        }
    }

    trackPost(_: number, post: BlogPostDto): string {
        return post.id;
    }

    async openPostAsync(post: BlogPostDto, event?: Event): Promise<void> {
        const currentBlog = this.blog;
        if (!currentBlog) {
            return;
        }

        if (event) {
            const target = event.target as HTMLElement | null;
            if (target?.closest('a,button,input,textarea,select,label')) {
                return;
            }
        }

        await this.router.navigate(['/blogs', currentBlog.ownerHandle, currentBlog.slug, post.slug]);
    }

    splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
        return splitHashtagText(content);
    }
}
