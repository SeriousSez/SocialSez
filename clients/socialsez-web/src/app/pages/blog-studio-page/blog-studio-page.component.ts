import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BlogDto, BlogPostDto, BlogThemeConfigDto } from '../../core/api.types';
import { renderMarkdownToHtml } from '../../core/markdown.util';
import { SessionService } from '../../core/session.service';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

interface BlogFormState {
    title: string;
    description: string;
    slug: string;
    isPublic: boolean;
    allowLikes: boolean;
    allowComments: boolean;
    allowShares: boolean;
    allowEmbeds: boolean;
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

type MarkdownToolAction = 'h2' | 'bold' | 'italic' | 'link' | 'ul' | 'ol' | 'quote' | 'inlineCode' | 'codeBlock';
type PostComposerView = 'write' | 'preview';

interface MarkdownInsertion {
    text: string;
    selectStart: number;
    selectEnd: number;
}

const CUSTOM_THEME_OPTION = '__custom__';
type BlogEditorSection = 'blog' | 'posts';

@Component({
    selector: 'app-blog-studio-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, SkeletonComponent],
    templateUrl: './blog-studio-page.component.html',
    styleUrl: './blog-studio-page.component.scss'
})
export class BlogStudioPageComponent {
    @ViewChild('contentEditor') contentEditor?: ElementRef<HTMLTextAreaElement>;
    @ViewChild('coverImageInput') coverImageInput?: ElementRef<HTMLInputElement>;
    @ViewChild('customCssEditor') customCssEditor?: ElementRef<HTMLTextAreaElement>;

    loading = true;
    loadingPosts = false;
    savingBlog = false;
    savingPost = false;
    uploadingPostCoverImage = false;
    deletingBlog = false;
    deletingPost = false;
    error = '';
    postError = '';

    blogs: BlogDto[] = [];
    posts: BlogPostDto[] = [];
    selectedBlogId: string | null = null;
    editingPostId: string | null = null;
    showBlogEditor = false;
    activeEditorSection: BlogEditorSection = 'blog';
    activePostComposerView: PostComposerView = 'write';

    readonly blogForm: BlogFormState = this.createEmptyBlogForm();
    readonly postForm: BlogPostFormState = this.createEmptyPostForm();
    fontFamilySelection = CUSTOM_THEME_OPTION;
    headerLayoutSelection = CUSTOM_THEME_OPTION;
    postListLayoutSelection = CUSTOM_THEME_OPTION;

    readonly fontFamilyOptions: ReadonlyArray<{ value: string; label: string }> = [
        { value: 'Georgia, serif', label: 'Georgia' },
        { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
        { value: 'Merriweather, Georgia, serif', label: 'Merriweather' },
        { value: 'Lora, Georgia, serif', label: 'Lora' },
        { value: 'Source Sans 3, Inter, sans-serif', label: 'Source Sans 3' },
        { value: CUSTOM_THEME_OPTION, label: 'Custom' }
    ];

    readonly headerLayoutOptions: ReadonlyArray<{ value: string; label: string }> = [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'split', label: 'Split' },
        { value: 'minimal', label: 'Minimal' },
        { value: CUSTOM_THEME_OPTION, label: 'Custom' }
    ];

    readonly postListLayoutOptions: ReadonlyArray<{ value: string; label: string }> = [
        { value: 'grid', label: 'Grid' },
        { value: 'stack', label: 'Stack' },
        { value: 'magazine', label: 'Magazine' },
        { value: CUSTOM_THEME_OPTION, label: 'Custom' }
    ];

    constructor(private readonly session: SessionService) {
        void this.loadAsync();
    }

    get selectedBlog(): BlogDto | null {
        if (!this.selectedBlogId) {
            return null;
        }

        return this.blogs.find(blog => blog.id === this.selectedBlogId) ?? null;
    }

    get postPreviewHtml(): string {
        return renderMarkdownToHtml(this.postForm.content);
    }

    get accentColorPickerValue(): string {
        return this.resolvePickerColor(this.blogForm.accentColor, '#ea580c');
    }

    get backgroundColorPickerValue(): string {
        return this.resolvePickerColor(this.blogForm.backgroundColor, '#fff7ed');
    }

    get surfaceColorPickerValue(): string {
        return this.resolvePickerColor(this.blogForm.surfaceColor, '#ffffff');
    }

    get showCustomFontFamilyInput(): boolean {
        return this.fontFamilySelection === CUSTOM_THEME_OPTION;
    }

    get showCustomHeaderLayoutInput(): boolean {
        return this.headerLayoutSelection === CUSTOM_THEME_OPTION;
    }

    get showCustomPostListLayoutInput(): boolean {
        return this.postListLayoutSelection === CUSTOM_THEME_OPTION;
    }

    get showAccentColorSpacer(): boolean {
        return this.showCustomFontFamilyInput;
    }

    get showHeaderLayoutSpacer(): boolean {
        return !this.showCustomHeaderLayoutInput && this.showCustomPostListLayoutInput;
    }

    get showPostListLayoutSpacer(): boolean {
        return !this.showCustomPostListLayoutInput && this.showCustomHeaderLayoutInput;
    }

    async loadAsync(): Promise<void> {
        this.loading = true;
        this.error = '';

        try {
            await this.session.bootstrapAsync();
            this.blogs = await this.session.loadMyBlogsAsync();

            if (this.selectedBlogId) {
                await this.selectBlogAsync(this.selectedBlogId);
            } else {
                this.closeBlogEditor();
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

        this.showBlogEditor = true;
        this.activeEditorSection = 'blog';
        this.selectedBlogId = blog.id;
        this.editingPostId = null;
        this.assignBlogForm(blog);
        this.resetPostForm();
        await this.loadPostsAsync(blog);
    }

    startNewBlog(): void {
        this.showBlogEditor = true;
        this.activeEditorSection = 'blog';
        this.selectedBlogId = null;
        this.editingPostId = null;
        this.posts = [];
        this.postError = '';
        this.assignBlogForm(null);
        this.resetPostForm();
    }

    closeBlogEditor(): void {
        this.showBlogEditor = false;
        this.activeEditorSection = 'blog';
        this.selectedBlogId = null;
        this.editingPostId = null;
        this.posts = [];
        this.postError = '';
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
                blog = await this.session.updateBlogAsync(this.selectedBlogId, title, description, slug, this.blogForm.isPublic, this.blogForm.allowLikes, this.blogForm.allowComments, this.blogForm.allowShares, this.blogForm.allowEmbeds, payload);
                this.blogs = this.blogs.map(item => item.id === blog.id ? blog : item);
            } else {
                blog = await this.session.createBlogAsync(title, description, slug, this.blogForm.isPublic, this.blogForm.allowLikes, this.blogForm.allowComments, this.blogForm.allowShares, this.blogForm.allowEmbeds, payload);
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
            this.closeBlogEditor();
        } catch {
            this.error = 'Could not delete this blog.';
        } finally {
            this.deletingBlog = false;
        }
    }

    editPost(post: BlogPostDto): void {
        this.activePostComposerView = 'write';
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
        this.activeEditorSection = 'posts';
        this.editingPostId = null;
        this.resetPostForm();
    }

    openEditorSection(section: BlogEditorSection): void {
        this.activeEditorSection = section;
    }

    setPostComposerView(view: PostComposerView): void {
        this.activePostComposerView = view;
    }

    openCoverImagePicker(): void {
        if (this.uploadingPostCoverImage) {
            return;
        }

        this.coverImageInput?.nativeElement.click();
    }

    async onCoverImageSelected(event: Event): Promise<void> {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0];
        if (!file || this.uploadingPostCoverImage) {
            return;
        }

        this.uploadingPostCoverImage = true;
        this.postError = '';

        try {
            this.postForm.coverImageUrl = await this.session.uploadImageAsync(file);
        } catch {
            this.postError = 'Could not upload cover image.';
        } finally {
            this.uploadingPostCoverImage = false;
            if (target) {
                target.value = '';
            }
        }
    }

    async savePostAsync(): Promise<void> {
        const selectedBlog = this.selectedBlog;
        if (!selectedBlog || this.savingPost || this.deletingPost || this.uploadingPostCoverImage) {
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

    insertMarkdown(action: MarkdownToolAction): void {
        const editor = this.contentEditor?.nativeElement;
        if (!editor) {
            return;
        }

        const value = this.postForm.content;
        const start = editor.selectionStart ?? 0;
        const end = editor.selectionEnd ?? 0;
        const selected = value.slice(start, end);
        const before = value.slice(0, start);
        const after = value.slice(end);

        const insertion = this.buildMarkdownInsertion(action, selected);
        this.postForm.content = `${before}${insertion.text}${after}`;

        const selectionStart = before.length + insertion.selectStart;
        const selectionEnd = before.length + insertion.selectEnd;

        setTimeout(() => {
            editor.focus();
            editor.setSelectionRange(selectionStart, selectionEnd);
        }, 0);
    }

    onFontFamilySelectionChange(): void {
        if (this.fontFamilySelection === CUSTOM_THEME_OPTION) {
            if (this.isValueFromOptions(this.blogForm.fontFamily, this.fontFamilyOptions)) {
                this.blogForm.fontFamily = '';
            }

            return;
        }

        this.blogForm.fontFamily = this.fontFamilySelection;
    }

    onHeaderLayoutSelectionChange(): void {
        if (this.headerLayoutSelection === CUSTOM_THEME_OPTION) {
            if (this.isValueFromOptions(this.blogForm.headerLayout, this.headerLayoutOptions)) {
                this.blogForm.headerLayout = '';
            }

            return;
        }

        this.blogForm.headerLayout = this.headerLayoutSelection;
    }

    onPostListLayoutSelectionChange(): void {
        if (this.postListLayoutSelection === CUSTOM_THEME_OPTION) {
            if (this.isValueFromOptions(this.blogForm.postListLayout, this.postListLayoutOptions)) {
                this.blogForm.postListLayout = '';
            }

            return;
        }

        this.blogForm.postListLayout = this.postListLayoutSelection;
    }

    onAccentColorPicked(value: string): void {
        this.blogForm.accentColor = (value ?? '').trim();
    }

    onBackgroundColorPicked(value: string): void {
        this.blogForm.backgroundColor = (value ?? '').trim();
    }

    onSurfaceColorPicked(value: string): void {
        this.blogForm.surfaceColor = (value ?? '').trim();
    }

    autoResizeCustomCss(event?: Event): void {
        const editor = (event?.target as HTMLTextAreaElement | null) ?? this.customCssEditor?.nativeElement;
        if (!editor) {
            return;
        }

        editor.style.height = 'auto';
        editor.style.height = `${editor.scrollHeight}px`;
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

    private buildMarkdownInsertion(action: MarkdownToolAction, selected: string): MarkdownInsertion {
        const hasSelection = selected.length > 0;

        switch (action) {
            case 'h2': {
                const label = hasSelection ? selected : 'Heading';
                const text = `## ${label}`;
                return {
                    text,
                    selectStart: hasSelection ? text.length : 3,
                    selectEnd: hasSelection ? text.length : text.length
                };
            }
            case 'bold': {
                const label = hasSelection ? selected : 'bold text';
                const text = `**${label}**`;
                return {
                    text,
                    selectStart: hasSelection ? text.length : 2,
                    selectEnd: hasSelection ? text.length : text.length - 2
                };
            }
            case 'italic': {
                const label = hasSelection ? selected : 'italic text';
                const text = `*${label}*`;
                return {
                    text,
                    selectStart: hasSelection ? text.length : 1,
                    selectEnd: hasSelection ? text.length : text.length - 1
                };
            }
            case 'inlineCode': {
                const label = hasSelection ? selected : 'code';
                const text = `\`${label}\``;
                return {
                    text,
                    selectStart: hasSelection ? text.length : 1,
                    selectEnd: hasSelection ? text.length : text.length - 1
                };
            }
            case 'link': {
                const label = hasSelection ? selected : 'link text';
                const text = `[${label}](https://example.com)`;
                const selectStart = text.indexOf('https://example.com');
                return {
                    text,
                    selectStart,
                    selectEnd: selectStart + 'https://example.com'.length
                };
            }
            case 'ul': {
                const base = hasSelection ? selected : 'list item';
                const text = base
                    .split('\n')
                    .map(line => `- ${line}`)
                    .join('\n');
                return { text, selectStart: text.length, selectEnd: text.length };
            }
            case 'ol': {
                const base = hasSelection ? selected : 'list item';
                const text = base
                    .split('\n')
                    .map((line, index) => `${index + 1}. ${line}`)
                    .join('\n');
                return { text, selectStart: text.length, selectEnd: text.length };
            }
            case 'quote': {
                const base = hasSelection ? selected : 'quote';
                const text = base
                    .split('\n')
                    .map(line => `> ${line}`)
                    .join('\n');
                return { text, selectStart: text.length, selectEnd: text.length };
            }
            case 'codeBlock': {
                const label = hasSelection ? selected : 'code here';
                const text = `\`\`\`\n${label}\n\`\`\``;
                const selectStart = hasSelection ? text.length : 4;
                const selectEnd = hasSelection ? text.length : 4 + label.length;
                return { text, selectStart, selectEnd };
            }
            default:
                return { text: selected, selectStart: selected.length, selectEnd: selected.length };
        }
    }

    private assignBlogForm(blog: BlogDto | null): void {
        if (!blog) {
            Object.assign(this.blogForm, this.createEmptyBlogForm());
            this.syncThemeSelectionsFromForm();
            this.queueCustomCssResize();
            return;
        }

        this.blogForm.title = blog.title;
        this.blogForm.description = blog.description ?? '';
        this.blogForm.slug = blog.slug;
        this.blogForm.isPublic = blog.isPublic;
        this.blogForm.allowLikes = blog.allowLikes;
        this.blogForm.allowComments = blog.allowComments;
        this.blogForm.allowShares = blog.allowShares;
        this.blogForm.allowEmbeds = blog.allowEmbeds;
        this.blogForm.fontFamily = blog.theme?.fontFamily ?? '';
        this.blogForm.accentColor = blog.theme?.accentColor ?? '';
        this.blogForm.backgroundColor = blog.theme?.backgroundColor ?? '';
        this.blogForm.surfaceColor = blog.theme?.surfaceColor ?? '';
        this.blogForm.headerLayout = blog.theme?.headerLayout ?? '';
        this.blogForm.postListLayout = blog.theme?.postListLayout ?? '';
        this.blogForm.customCss = blog.theme?.customCss ?? '';
        this.syncThemeSelectionsFromForm();
        this.queueCustomCssResize();
    }

    private queueCustomCssResize(): void {
        setTimeout(() => this.autoResizeCustomCss(), 0);
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
        this.activePostComposerView = 'write';
        Object.assign(this.postForm, this.createEmptyPostForm());
    }

    private createEmptyBlogForm(): BlogFormState {
        return {
            title: '',
            description: '',
            slug: '',
            isPublic: true,
            allowLikes: true,
            allowComments: true,
            allowShares: true,
            allowEmbeds: true,
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

    private syncThemeSelectionsFromForm(): void {
        this.fontFamilySelection = this.findMatchingOptionOrCustom(this.blogForm.fontFamily, this.fontFamilyOptions);
        this.headerLayoutSelection = this.findMatchingOptionOrCustom(this.blogForm.headerLayout, this.headerLayoutOptions);
        this.postListLayoutSelection = this.findMatchingOptionOrCustom(this.blogForm.postListLayout, this.postListLayoutOptions);
    }

    private findMatchingOptionOrCustom(value: string, options: ReadonlyArray<{ value: string }>): string {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return CUSTOM_THEME_OPTION;
        }

        const match = options.find(option => option.value !== CUSTOM_THEME_OPTION && option.value.trim().toLowerCase() === normalized);
        return match?.value ?? CUSTOM_THEME_OPTION;
    }

    private isValueFromOptions(value: string, options: ReadonlyArray<{ value: string }>): boolean {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return options.some(option => option.value !== CUSTOM_THEME_OPTION && option.value.trim().toLowerCase() === normalized);
    }

    private resolvePickerColor(value: string, fallback: string): string {
        const normalized = value.trim();
        return this.isHexColor(normalized) ? normalized : fallback;
    }

    private isHexColor(value: string): boolean {
        return /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value);
    }
}
