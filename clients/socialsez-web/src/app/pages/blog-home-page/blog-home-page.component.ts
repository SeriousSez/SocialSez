import { CommonModule, NgStyle } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BlogDto, BlogPostDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-blog-home-page',
    standalone: true,
    imports: [CommonModule, RouterLink, NgStyle],
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

    constructor(
        private readonly route: ActivatedRoute,
        private readonly session: SessionService
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
            if (!loadedBlog) {
                this.error = 'Blog was not found or is private.';
                this.blog = null;
                this.posts = [];
                return;
            }

            this.blog = loadedBlog;
            this.posts = await this.session.loadBlogPostsAsync(this.handle, this.blogSlug);
        } catch {
            this.error = 'Could not load this blog right now.';
            this.blog = null;
            this.posts = [];
        } finally {
            this.loading = false;
        }
    }

    trackPost(_: number, post: BlogPostDto): string {
        return post.id;
    }
}
