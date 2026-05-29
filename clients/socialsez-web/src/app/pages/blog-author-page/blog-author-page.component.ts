import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BlogDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

@Component({
    selector: 'app-blog-author-page',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslatePipe, SkeletonComponent],
    templateUrl: './blog-author-page.component.html',
    styleUrl: './blog-author-page.component.scss'
})
export class BlogAuthorPageComponent {
    loading = true;
    error = '';
    handle = '';
    blogs: BlogDto[] = [];
    private readonly translate = inject(TranslateService);

    constructor(
        private readonly route: ActivatedRoute,
        private readonly session: SessionService
    ) {
        this.route.paramMap.subscribe(paramMap => {
            this.handle = (paramMap.get('handle') ?? '').trim().toLowerCase();
            void this.loadAsync();
        });
    }

    get isCurrentViewer(): boolean {
        const me = this.session.profile?.handle?.trim().toLowerCase();
        return !!me && me === this.handle;
    }

    async loadAsync(): Promise<void> {
        if (!this.handle) {
            this.error = this.t('blogStudioPage.blogAuthor.errors.notFound');
            this.loading = false;
            return;
        }

        this.loading = true;
        this.error = '';

        try {
            await this.session.bootstrapAsync();
            this.blogs = await this.session.loadBlogsByAuthorHandleAsync(this.handle);
        } catch {
            this.error = this.t('blogStudioPage.blogAuthor.errors.loadNow');
        } finally {
            this.loading = false;
        }
    }

    trackBlog(_: number, blog: BlogDto): string {
        return blog.id;
    }

    private t(key: string, params?: Record<string, unknown>): string {
        return this.translate.instant(key, params);
    }
}
