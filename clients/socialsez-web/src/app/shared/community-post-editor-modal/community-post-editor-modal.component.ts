import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommunityPostDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { RichTextEditorComponent } from '../rich-text-editor/rich-text-editor.component';

interface EditImageEntry {
    url: string;
    file: File | null;
    isObjectUrl: boolean;
}

export interface CommunityPostEditorSavePayload {
    title: string | null;
    linkUrl: string | null;
    content: string | null;
    mediaContent: string | null;
    imageUrls: string[] | null;
    pollQuestion: string | null;
    pollOptions: string[] | null;
    clearPoll: boolean;
}

@Component({
    selector: 'app-community-post-editor-modal, app-community-post-edit-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, RichTextEditorComponent],
    templateUrl: './community-post-editor-modal.component.html',
    styleUrl: './community-post-editor-modal.component.scss'
})
export class CommunityPostEditorModalComponent implements OnChanges, OnDestroy {
    @Input() open = false;
    @Input() post: CommunityPostDto | null = null;
    @Input() busy = false;
    @Input() errorMessage = '';

    @Output() cancel = new EventEmitter<void>();
    @Output() save = new EventEmitter<CommunityPostEditorSavePayload>();

    tab: 'text' | 'media' | 'link' | 'poll' = 'text';
    title = '';
    content = '';
    mediaContent = '';
    linkUrl = '';
    pollQuestion = '';
    pollOptions: string[] = ['', ''];
    editPostImageEntries: EditImageEntry[] = [];
    editPostActiveImageIndex = 0;
    validationError = '';
    private uploadingImages = false;

    constructor(private readonly session: SessionService) { }

    trackByIndex(index: number): number {
        return index;
    }

    ngOnDestroy(): void {
        this.clearEditPostImageEntries();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if ((changes['open'] || changes['post']) && this.open && this.post) {
            this.initializeFromPost(this.post);
        }
    }

    setTab(next: 'text' | 'media' | 'link' | 'poll'): void {
        this.tab = next;
        this.validationError = '';
    }

    onEditPostImagesSelected(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const selectedFiles = target?.files ? Array.from(target.files) : [];
        if (!selectedFiles.length) {
            return;
        }

        const remainingSlots = Math.max(0, 10 - this.editPostImageEntries.length);
        if (!remainingSlots) {
            return;
        }

        const accepted = selectedFiles
            .filter(file => file.type.startsWith('image/'))
            .slice(0, remainingSlots)
            .map(file => ({
                url: URL.createObjectURL(file),
                file,
                isObjectUrl: true
            } as EditImageEntry));

        if (!accepted.length) {
            return;
        }

        this.editPostImageEntries = [...this.editPostImageEntries, ...accepted];
        this.editPostActiveImageIndex = this.editPostImageEntries.length - accepted.length;

        if (target) {
            target.value = '';
        }
    }

    get activeEditPostImagePreviewUrl(): string | null {
        if (!this.editPostImageEntries.length) {
            return null;
        }

        const safeIndex = Math.min(Math.max(this.editPostActiveImageIndex, 0), this.editPostImageEntries.length - 1);
        return this.editPostImageEntries[safeIndex]?.url ?? null;
    }

    get canMoveEditPostImageBack(): boolean {
        return this.editPostActiveImageIndex > 0;
    }

    get canMoveEditPostImageForward(): boolean {
        return this.editPostActiveImageIndex < this.editPostImageEntries.length - 1;
    }

    showPreviousEditPostImage(): void {
        if (!this.canMoveEditPostImageBack) {
            return;
        }

        this.editPostActiveImageIndex -= 1;
    }

    showNextEditPostImage(): void {
        if (!this.canMoveEditPostImageForward) {
            return;
        }

        this.editPostActiveImageIndex += 1;
    }

    setActiveEditPostImage(index: number): void {
        if (index < 0 || index >= this.editPostImageEntries.length) {
            return;
        }

        this.editPostActiveImageIndex = index;
    }

    removeEditPostImage(index: number): void {
        if (index < 0 || index >= this.editPostImageEntries.length) {
            return;
        }

        const entry = this.editPostImageEntries[index];
        if (entry?.isObjectUrl) {
            URL.revokeObjectURL(entry.url);
        }

        this.editPostImageEntries = this.editPostImageEntries.filter((_, itemIndex) => itemIndex !== index);
        if (this.editPostActiveImageIndex >= this.editPostImageEntries.length) {
            this.editPostActiveImageIndex = Math.max(0, this.editPostImageEntries.length - 1);
        }
    }

    get isBusy(): boolean {
        return this.busy || this.uploadingImages;
    }

    addPollOption(): void {
        if (this.pollOptions.length >= 6) {
            return;
        }

        this.pollOptions = [...this.pollOptions, ''];
    }

    removePollOption(index: number): void {
        if (this.pollOptions.length <= 2) {
            return;
        }

        this.pollOptions = this.pollOptions.filter((_value, i) => i !== index);
    }

    onCancel(): void {
        if (this.isBusy) {
            return;
        }

        this.cancel.emit();
    }

    async onSave(): Promise<void> {
        if (!this.post || this.isBusy) {
            return;
        }

        const title = this.title.trim() || null;
        const content = this.resolveTextContent();
        const mediaContent = this.resolveMediaContent();
        const normalizedLink = this.normalizeOptionalHttpUrl(this.linkUrl);
        if (normalizedLink.error) {
            this.validationError = normalizedLink.error;
            return;
        }

        const linkUrl = this.tab === 'link' ? normalizedLink.value : null;
        const pollQuestion = this.tab === 'poll' ? this.pollQuestion.trim() || null : null;
        const pollOptions = this.tab === 'poll'
            ? this.pollOptions.map(option => option.trim()).filter(option => !!option)
            : null;
        const clearPoll = this.tab !== 'poll';
        const hasImages = this.tab === 'media' && this.editPostImageEntries.length > 0;
        if (!title) {
            this.validationError = 'Title is required.';
            return;
        }

        if (!content && !mediaContent && !linkUrl && !hasImages && !pollQuestion) {
            this.validationError = 'Add text, image, link, or poll before saving.';
            return;
        }

        this.validationError = '';
        this.uploadingImages = true;

        let imageUrls: string[] | null = null;
        if (this.tab === 'media') {
            try {
                imageUrls = await this.resolveEditPostImageUrlsAsync();
            } catch {
                this.validationError = 'Unable to upload one or more images.';
                this.uploadingImages = false;
                return;
            }
        }

        this.uploadingImages = false;
        this.save.emit({
            title,
            linkUrl,
            content,
            mediaContent,
            imageUrls,
            pollQuestion,
            pollOptions,
            clearPoll
        });
    }

    private initializeFromPost(post: CommunityPostDto): void {
        this.clearEditPostImageEntries();
        this.title = post.title ?? '';
        this.linkUrl = post.linkUrl ?? '';
        this.content = post.content ?? '';
        this.mediaContent = post.mediaContent ?? post.content ?? '';
        this.pollQuestion = '';
        this.pollOptions = ['', ''];
        this.editPostImageEntries = (post.imageUrls ?? [])
            .filter(url => !!url)
            .map(url => ({
                url,
                file: null,
                isObjectUrl: false
            }));
        this.editPostActiveImageIndex = 0;
        this.validationError = '';
        this.uploadingImages = false;

        if (post.poll) {
            this.tab = 'poll';
            this.pollQuestion = post.poll.question;
            this.pollOptions = post.poll.options.map(option => option.text).slice(0, 6);
            while (this.pollOptions.length < 2) {
                this.pollOptions.push('');
            }
            return;
        }

        if (this.editPostImageEntries.length > 0 || !!post.imageUrl) {
            this.tab = 'media';
            return;
        }

        if ((post.linkUrl ?? '').trim()) {
            this.tab = 'link';
            return;
        }

        this.tab = 'text';
    }

    private resolveTextContent(): string | null {
        return this.content.trim() || null;
    }

    private resolveMediaContent(): string | null {
        return this.mediaContent.trim() || null;
    }

    private async resolveEditPostImageUrlsAsync(): Promise<string[]> {
        const urls: string[] = [];

        for (const entry of this.editPostImageEntries) {
            if (entry.file) {
                const uploaded = await this.session.uploadImageAsync(entry.file);
                if (uploaded) {
                    urls.push(uploaded);
                }

                continue;
            }

            const existingUrl = entry.url.trim();
            if (existingUrl) {
                urls.push(existingUrl);
            }
        }

        return urls;
    }

    private clearEditPostImageEntries(): void {
        for (const entry of this.editPostImageEntries) {
            if (entry.isObjectUrl) {
                URL.revokeObjectURL(entry.url);
            }
        }

        this.editPostImageEntries = [];
        this.editPostActiveImageIndex = 0;
    }

    private normalizeOptionalHttpUrl(raw: string): { value: string | null; error?: string } {
        const trimmed = raw.trim();
        if (!trimmed) {
            return { value: null };
        }

        const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

        try {
            const parsed = new URL(candidate);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return { value: null, error: 'Link URL must start with http:// or https://.' };
            }

            return { value: parsed.toString() };
        } catch {
            return { value: null, error: 'Enter a valid link URL.' };
        }
    }
}
