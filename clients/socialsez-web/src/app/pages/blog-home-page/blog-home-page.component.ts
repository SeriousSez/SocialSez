import { CommonModule, NgStyle } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BlogDto, BlogPostDto } from '../../core/api.types';
import { HashtagTextPart, splitHashtagText } from '../../core/hashtag-text.util';
import { SessionService } from '../../core/session.service';
import { LazyImageComponent } from '../../shared/lazy-image/lazy-image.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

@Component({
    selector: 'app-blog-home-page',
    standalone: true,
    imports: [CommonModule, RouterLink, NgStyle, LazyImageComponent, SkeletonComponent],
    templateUrl: './blog-home-page.component.html',
    styleUrl: './blog-home-page.component.scss'
})
export class BlogHomePageComponent implements OnDestroy {
    loading = true;
    error = '';
    handle = '';
    blogSlug = '';
    blog: BlogDto | null = null;
    posts: BlogPostDto[] = [];
    savingPostId: string | null = null;
    private loadVersion = 0;
    private customCssStyleEl: HTMLStyleElement | null = null;
    private appliedCustomCss = '';

    constructor(
        private readonly route: ActivatedRoute,
        private readonly session: SessionService,
        private readonly router: Router,
        private readonly cdr: ChangeDetectorRef
    ) {
        this.route.paramMap.subscribe(paramMap => {
            this.handle = (paramMap.get('handle') ?? '').trim().toLowerCase();
            this.blogSlug = (paramMap.get('blogSlug') ?? '').trim().toLowerCase();
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

    get postLayoutClass(): string {
        return this.blog?.theme?.postListLayout?.toLowerCase() === 'grid' ? 'grid' : 'stack';
    }

    get headerLayoutClass(): string {
        return this.blog?.theme?.headerLayout?.toLowerCase() === 'center' ? 'center' : 'left';
    }

    get canToggleSave(): boolean {
        return !!this.session.profile;
    }

    async loadAsync(): Promise<void> {
        const loadVersion = ++this.loadVersion;

        if (!this.handle || !this.blogSlug) {
            this.error = 'Blog was not found.';
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
            if (loadVersion !== this.loadVersion) {
                return;
            }

            if (!loadedBlog) {
                this.error = 'Blog was not found or is private.';
                this.blog = null;
                this.posts = [];
                this.applyCustomCss('');
                return;
            }

            this.blog = loadedBlog;
            this.applyCustomCss(this.customCss);
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
            this.customCssStyleEl.setAttribute('data-blog-custom-css', 'blog-home-page');
            document.head.appendChild(this.customCssStyleEl);
        }

        this.customCssStyleEl.textContent = normalized;
        this.appliedCustomCss = normalized;
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

    async toggleSavedPostAsync(post: BlogPostDto, event: Event): Promise<void> {
        event.preventDefault();
        event.stopPropagation();

        if (this.savingPostId || !this.canToggleSave) {
            return;
        }

        this.savingPostId = post.id;
        this.error = '';

        try {
            if (post.isSavedByMe) {
                await this.session.unsaveBlogPostAsync(post.blogId, post.id);
                this.posts = this.posts.map(item => item.id === post.id ? { ...item, isSavedByMe: false } : item);
            } else {
                const saved = await this.session.openSaveToCollectionModalAsync({
                    kind: 'blog-post',
                    itemId: post.id,
                    blogId: post.blogId,
                    label: post.title
                });

                if (saved) {
                    this.posts = this.posts.map(item => item.id === post.id ? { ...item, isSavedByMe: true } : item);
                }
            }
        } catch {
            this.error = 'Could not update saved status right now.';
        } finally {
            this.savingPostId = null;
            this.cdr.detectChanges();
        }
    }

    splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
        return splitHashtagText(content);
    }
}
