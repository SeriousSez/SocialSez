import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BlogDto, BlogPostDto, BlogThemeConfigDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

interface BlogFormState {
    title: string;
    description: string;
    slug: string;
    isPublic: boolean;
    fontFamily: string;
    accentColor: string;
    backgroundColor: string;
    surfaceColor: string;
    headerLayout: string;
    postListLayout: string;
    customCss: string;
}

interface BlogPostFormState {
    title: string;
    slug: string;
    excerpt: string;
    coverImageUrl: string;
    tags: string;
    content: string;
    isPublished: boolean;
}

@Component({
    selector: 'app-blog-studio-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './blog-studio-page.component.html',
    styleUrl: './blog-studio-page.component.scss'
})
export class BlogStudioPageComponent {
    loading = true;
    loadingPosts = false;
    savingBlog = false;
    savingPost = false;
    deletingBlog = false;
    deletingPost = false;
    error = '';
    postError = '';

    blogs: BlogDto[] = [];
    posts: BlogPostDto[] = [];
    selectedBlogId: string | null = null;
    editingPostId: string | null = null;

    readonly blogForm: BlogFormState = this.createEmptyBlogForm();
    readonly postForm: BlogPostFormState = this.createEmptyPostForm();

    constructor(private readonly session: SessionService) {
        void this.loadAsync();
    }

    get selectedBlog(): BlogDto | null {
        if (!this.selectedBlogId) {
            return null;
        }

        return this.blogs.find(blog => blog.id === this.selectedBlogId) ?? null;
    }

    async loadAsync(): Promise<void> {
        this.loading = true;
        this.error = '';

        try {
            await this.session.bootstrapAsync();
            this.blogs = await this.session.loadMyBlogsAsync();

            if (!this.selectedBlogId && this.blogs.length > 0) {
                await this.selectBlogAsync(this.blogs[0].id);
            } else if (this.selectedBlogId) {
                await this.selectBlogAsync(this.selectedBlogId);
            }
        } catch {
            this.error = 'Could not load your blogs.';
        } finally {
            this.loading = false;
        }
    }

    async selectBlogAsync(blogId: string): Promise<void> {
        const blog = this.blogs.find(item => item.id === blogId);
        if (!blog) {
            return;
        }

        this.selectedBlogId = blog.id;
        this.editingPostId = null;
        this.assignBlogForm(blog);
        this.resetPostForm();
        await this.loadPostsAsync(blog);
    }

    startNewBlog(): void {
        this.selectedBlogId = null;
        this.editingPostId = null;
        this.posts = [];
        this.assignBlogForm(null);
        this.resetPostForm();
    }

    async saveBlogAsync(): Promise<void> {
        if (this.savingBlog || this.deletingBlog) {
            return;
        }

        this.savingBlog = true;
        this.error = '';

        try {
            const payload = this.buildThemePayload();
            const title = this.blogForm.title.trim();
            const description = this.toOptional(this.blogForm.description);
            const slug = this.toOptional(this.blogForm.slug);

            let blog: BlogDto;
            if (this.selectedBlogId) {
                blog = await this.session.updateBlogAsync(this.selectedBlogId, title, description, slug, this.blogForm.isPublic, payload);
                this.blogs = this.blogs.map(item => item.id === blog.id ? blog : item);
            } else {
                blog = await this.session.createBlogAsync(title, description, slug, this.blogForm.isPublic, payload);
                this.blogs = [blog, ...this.blogs];
            }

            await this.selectBlogAsync(blog.id);
        } catch {
            this.error = 'Could not save blog. Make sure title is set.';
        } finally {
            this.savingBlog = false;
        }
    }

    async deleteSelectedBlogAsync(): Promise<void> {
        const selectedBlog = this.selectedBlog;
        if (!selectedBlog || this.deletingBlog || this.savingBlog || this.savingPost || this.deletingPost) {
            return;
        }

        const confirmed = window.confirm(`Delete blog "${selectedBlog.title}" and all posts? This cannot be undone.`);
        if (!confirmed) {
            return;
        }

        this.deletingBlog = true;
        this.error = '';

        try {
            await this.session.deleteBlogAsync(selectedBlog.id);
            this.blogs = this.blogs.filter(blog => blog.id !== selectedBlog.id);
            this.startNewBlog();

            if (this.blogs.length > 0) {
                await this.selectBlogAsync(this.blogs[0].id);
            }
        } catch {
            this.error = 'Could not delete this blog.';
        } finally {
            this.deletingBlog = false;
        }
    }

    editPost(post: BlogPostDto): void {
        this.editingPostId = post.id;
        this.postForm.title = post.title;
        this.postForm.slug = post.slug;
        this.postForm.excerpt = post.excerpt ?? '';
        this.postForm.coverImageUrl = post.coverImageUrl ?? '';
        this.postForm.tags = post.tags.join(', ');
        this.postForm.content = post.content;
        this.postForm.isPublished = post.isPublished;
    }

    startNewPost(): void {
        this.editingPostId = null;
        this.resetPostForm();
    }

    async savePostAsync(): Promise<void> {
        const selectedBlog = this.selectedBlog;
        if (!selectedBlog || this.savingPost || this.deletingPost) {
            return;
        }

        this.savingPost = true;
        this.postError = '';

        try {
            const title = this.postForm.title.trim();
            const content = this.postForm.content.trim();
            const excerpt = this.toOptional(this.postForm.excerpt);
            const coverImageUrl = this.toOptional(this.postForm.coverImageUrl);
            const slug = this.toOptional(this.postForm.slug);
            const tags = this.parseTags(this.postForm.tags);

            let saved: BlogPostDto;
            if (this.editingPostId) {
                saved = await this.session.updateBlogPostAsync(selectedBlog.id, this.editingPostId, title, content, excerpt, coverImageUrl, tags, this.postForm.isPublished, slug);
                this.posts = this.posts.map(post => post.id === saved.id ? saved : post);
            } else {
                saved = await this.session.createBlogPostAsync(selectedBlog.id, title, content, excerpt, coverImageUrl, tags, this.postForm.isPublished, slug);
                this.posts = [saved, ...this.posts];
            }

            this.editPost(saved);
        } catch {
            this.postError = 'Could not save blog post. Make sure title and content are set.';
        } finally {
            this.savingPost = false;
        }
    }

    async deleteEditingPostAsync(): Promise<void> {
        const selectedBlog = this.selectedBlog;
        const postId = this.editingPostId;
        if (!selectedBlog || !postId || this.deletingPost || this.savingPost || this.deletingBlog) {
            return;
        }

        const post = this.posts.find(item => item.id === postId);
        const postTitle = post?.title ?? 'this post';
        const confirmed = window.confirm(`Delete "${postTitle}"? This cannot be undone.`);
        if (!confirmed) {
            return;
        }

        this.deletingPost = true;
        this.postError = '';

        try {
            await this.session.deleteBlogPostAsync(selectedBlog.id, postId);
            this.posts = this.posts.filter(item => item.id !== postId);
            this.startNewPost();
        } catch {
            this.postError = 'Could not delete this post.';
        } finally {
            this.deletingPost = false;
        }
    }

    trackBlog(_: number, blog: BlogDto): string {
        return blog.id;
    }

    trackPost(_: number, post: BlogPostDto): string {
        return post.id;
    }

    private async loadPostsAsync(blog: BlogDto): Promise<void> {
        this.loadingPosts = true;
        this.postError = '';

        try {
            this.posts = await this.session.loadBlogPostsAsync(blog.ownerHandle, blog.slug);
        } catch {
            this.posts = [];
            this.postError = 'Could not load posts for this blog.';
        } finally {
            this.loadingPosts = false;
        }
    }

    private assignBlogForm(blog: BlogDto | null): void {
        if (!blog) {
            Object.assign(this.blogForm, this.createEmptyBlogForm());
            return;
        }

        this.blogForm.title = blog.title;
        this.blogForm.description = blog.description ?? '';
        this.blogForm.slug = blog.slug;
        this.blogForm.isPublic = blog.isPublic;
        this.blogForm.fontFamily = blog.theme?.fontFamily ?? '';
        this.blogForm.accentColor = blog.theme?.accentColor ?? '';
        this.blogForm.backgroundColor = blog.theme?.backgroundColor ?? '';
        this.blogForm.surfaceColor = blog.theme?.surfaceColor ?? '';
        this.blogForm.headerLayout = blog.theme?.headerLayout ?? '';
        this.blogForm.postListLayout = blog.theme?.postListLayout ?? '';
        this.blogForm.customCss = blog.theme?.customCss ?? '';
    }

    private buildThemePayload(): BlogThemeConfigDto {
        return {
            fontFamily: this.toOptional(this.blogForm.fontFamily) ?? undefined,
            accentColor: this.toOptional(this.blogForm.accentColor) ?? undefined,
            backgroundColor: this.toOptional(this.blogForm.backgroundColor) ?? undefined,
            surfaceColor: this.toOptional(this.blogForm.surfaceColor) ?? undefined,
            headerLayout: this.toOptional(this.blogForm.headerLayout) ?? undefined,
            postListLayout: this.toOptional(this.blogForm.postListLayout) ?? undefined,
            customCss: this.toOptional(this.blogForm.customCss) ?? undefined
        };
    }

    private parseTags(value: string): string[] {
        const normalized = value
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
        return normalized.length > 0 ? normalized : [];
    }

    private toOptional(value: string): string | null {
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
    }

    private resetPostForm(): void {
        Object.assign(this.postForm, this.createEmptyPostForm());
    }

    private createEmptyBlogForm(): BlogFormState {
        return {
            title: '',
            description: '',
            slug: '',
            isPublic: true,
            fontFamily: '',
            accentColor: '',
            backgroundColor: '',
            surfaceColor: '',
            headerLayout: '',
            postListLayout: '',
            customCss: ''
        };
    }

    private createEmptyPostForm(): BlogPostFormState {
        return {
            title: '',
            slug: '',
            excerpt: '',
            coverImageUrl: '',
            tags: '',
            content: '',
            isPublished: true
        };
    }
}
