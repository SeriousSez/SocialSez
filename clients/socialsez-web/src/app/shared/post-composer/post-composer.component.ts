import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImageCroppedEvent, ImageCropperComponent, LoadedImage } from 'ngx-image-cropper';
import { ProfileDto } from '../../core/api.types';
import { RichTextEditorComponent } from '../rich-text-editor/rich-text-editor.component';
import { SessionService } from '../../core/session.service';
import { UploadProgressService } from '../../core/upload-progress.service';

@Component({
    selector: 'app-post-composer',
    standalone: true,
    imports: [CommonModule, FormsModule, ImageCropperComponent, RichTextEditorComponent],
    templateUrl: './post-composer.component.html',
    styleUrl: './post-composer.component.scss'
})
export class PostComposerComponent implements OnDestroy {
    readonly maxContentLength = 3000;

    @Input() showCancel = false;
    @Input() title = 'Compose';
    @Input() subtitle = 'Share a thought, launch update, or quick note.';

    @Output() posted = new EventEmitter<void>();
    @Output() canceled = new EventEmitter<void>();

    content = '';
    mediaPreviewUrl = '';
    mediaPreviewUrls: string[] = [];
    status = '';
    uploadingMedia = false;
    markSensitive = false;
    mediaKind: 'none' | 'image-croppable' | 'image-static' | 'video' | 'multi-image' = 'none';
    cropOutputFormat: 'jpeg' | 'png' = 'jpeg';

    selectedMediaFiles: File[] = [];
    mentionResults: ProfileDto[] = [];
    mentionOpen = false;
    mentionLoading = false;
    private previewObjectUrls: string[] = [];
    private croppedImageBlob: Blob | null = null;
    private croppedObjectUrl = '';
    private mentionRangeStart = -1;
    private mentionRangeEnd = -1;
    private mentionSearchDebounceId: number | null = null;
    private mentionSearchToken = 0;

    @ViewChild('composerTextarea')
    private composerTextareaRef?: ElementRef<HTMLTextAreaElement>;

    @ViewChild('postMediaInput')
    private postMediaInputRef?: ElementRef<HTMLInputElement>;

    constructor(
        private readonly session: SessionService,
        private readonly uploadProgress: UploadProgressService
    ) { }

    ngOnDestroy(): void {
        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }

        this.clearSelectedMedia();
    }

    onEditorContentChanged(value: string): void {
        this.content = this.normalizeContentLength(value ?? '');
    }

    onContentInput(value: string, textarea: HTMLTextAreaElement): void {
        const normalizedValue = this.normalizeContentLength(value);
        this.content = normalizedValue;

        if (normalizedValue !== value) {
            const nextCaret = Math.min(textarea.selectionStart ?? normalizedValue.length, normalizedValue.length);
            textarea.value = normalizedValue;
            textarea.setSelectionRange(nextCaret, nextCaret);
        }

        this.updateMentionSuggestions(this.content, Math.min(textarea.selectionStart ?? this.content.length, this.content.length));
    }

    onContentCursor(textarea: HTMLTextAreaElement): void {
        this.updateMentionSuggestions(this.content, textarea.selectionStart ?? this.content.length);
    }

    onContentBlur(): void {
        window.setTimeout(() => {
            this.closeMentionSuggestions();
        }, 120);
    }

    async selectMention(profile: ProfileDto): Promise<void> {
        if (!this.mentionOpen || this.mentionRangeStart < 0 || this.mentionRangeEnd < this.mentionRangeStart) {
            return;
        }

        const replacement = `@${profile.handle} `;
        const mergedContent = `${this.content.slice(0, this.mentionRangeStart)}${replacement}${this.content.slice(this.mentionRangeEnd)}`;
        this.content = this.normalizeContentLength(mergedContent);

        const nextCaret = Math.min(this.mentionRangeStart + replacement.length, this.content.length);
        this.closeMentionSuggestions();

        await Promise.resolve();
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) {
            return;
        }

        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
    }

    async publish(): Promise<void> {
        if ((!this.content.trim() && this.selectedMediaFiles.length === 0) || this.uploadingMedia) {
            return;
        }

        this.uploadingMedia = true;
        this.status = '';
        const handle = this.uploadProgress.begin('Publishing post...');

        try {
            const mediaFiles = this.buildUploadFiles();
            await this.session.createPostAsync(this.content.trim(), mediaFiles.length > 0 ? mediaFiles : undefined, this.markSensitive);
            this.content = '';
            this.markSensitive = false;
            this.clearSelectedMedia();
            this.status = 'Posted.';
            handle.succeed('Post published!');
            this.posted.emit();
        } catch {
            this.status = 'Could not create post.';
            handle.fail('Post failed');
        } finally {
            this.uploadingMedia = false;
        }
    }

    cancel(): void {
        if (this.uploadingMedia) {
            return;
        }

        this.content = '';
        this.markSensitive = false;
        this.clearSelectedMedia();
        this.status = '';
        this.canceled.emit();
    }

    openPostMediaPicker(): void {
        if (this.uploadingMedia) {
            return;
        }

        this.postMediaInputRef?.nativeElement.click();
    }

    onPostMediaSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        if (files.length === 0) {
            return;
        }

        const nonMediaFiles = files.filter(file => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
        if (nonMediaFiles.length > 0) {
            this.clearSelectedMedia();
            this.status = 'Unsupported file type selected.';
            input.value = '';
            return;
        }

        const videoFiles = files.filter(file => file.type.startsWith('video/'));
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        if (videoFiles.length > 0 && files.length > 1) {
            this.clearSelectedMedia();
            this.status = 'Select one video or multiple images.';
            input.value = '';
            return;
        }

        if (imageFiles.length > 1 && videoFiles.length > 0) {
            this.clearSelectedMedia();
            this.status = 'Select one video or multiple images.';
            input.value = '';
            return;
        }

        this.clearSelectedMedia();

        if (imageFiles.length > 1) {
            this.selectedMediaFiles = imageFiles.slice(0, 12);
            this.previewObjectUrls = this.selectedMediaFiles.map(file => URL.createObjectURL(file));
            this.mediaPreviewUrls = [...this.previewObjectUrls];
            this.mediaKind = 'multi-image';
            this.cropOutputFormat = 'jpeg';
            this.status = `${this.selectedMediaFiles.length} images attached.`;
            input.value = '';
            return;
        }

        const file = files[0];
        if (!file) {
            input.value = '';
            return;
        }

        this.selectedMediaFiles = [file];
        this.previewObjectUrls = [URL.createObjectURL(file)];
        this.mediaPreviewUrl = this.previewObjectUrls[0] ?? '';
        this.mediaPreviewUrls = [this.mediaPreviewUrl];

        if (file.type.startsWith('video/')) {
            this.mediaKind = 'video';
            this.cropOutputFormat = 'jpeg';
            this.status = 'Video attached.';
        } else if (file.type === 'image/gif') {
            this.mediaKind = 'image-static';
            this.cropOutputFormat = 'jpeg';
        } else if (file.type.startsWith('image/')) {
            this.mediaKind = 'image-croppable';
            this.cropOutputFormat = 'jpeg';
            this.status = 'Image attached. Drag the crop frame and corners to crop.';
        } else {
            this.mediaKind = 'none';
            this.status = 'Unsupported file type selected.';
            this.clearSelectedMedia();
            return;
        }

        input.value = '';
    }

    onImageCropped(event: ImageCroppedEvent): void {
        this.croppedImageBlob = event.blob ?? null;

        if (this.croppedObjectUrl) {
            URL.revokeObjectURL(this.croppedObjectUrl);
            this.croppedObjectUrl = '';
        }

        if (event.objectUrl) {
            this.croppedObjectUrl = event.objectUrl;
        }
    }

    onImageLoaded(_: LoadedImage): void {
        this.status = 'Drag the crop frame and corners to crop.';
    }

    onLoadImageFailed(): void {
        this.clearSelectedMedia();
        this.status = 'Could not read selected image.';
    }

    removePostMedia(): void {
        this.clearSelectedMedia();
        this.status = 'Media removed.';
    }

    private updateMentionSuggestions(value: string, caret: number): void {
        const context = this.extractMentionContext(value, caret);
        if (!context || !context.query) {
            this.closeMentionSuggestions();
            return;
        }

        this.mentionRangeStart = context.start;
        this.mentionRangeEnd = caret;

        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }

        this.mentionLoading = true;
        const token = ++this.mentionSearchToken;
        this.mentionSearchDebounceId = window.setTimeout(async () => {
            this.mentionSearchDebounceId = null;

            try {
                const profiles = await this.session.searchProfilesAsync(context.query);
                if (token !== this.mentionSearchToken) {
                    return;
                }

                const currentHandle = this.session.profile?.handle.toLowerCase() ?? '';
                this.mentionResults = profiles.filter(profile => profile.handle.toLowerCase() !== currentHandle).slice(0, 6);
                this.mentionOpen = this.mentionResults.length > 0;
            } catch {
                if (token !== this.mentionSearchToken) {
                    return;
                }

                this.mentionResults = [];
                this.mentionOpen = false;
            } finally {
                if (token === this.mentionSearchToken) {
                    this.mentionLoading = false;
                }
            }
        }, 200);
    }

    private closeMentionSuggestions(): void {
        this.mentionOpen = false;
        this.mentionResults = [];
        this.mentionLoading = false;
        this.mentionRangeStart = -1;
        this.mentionRangeEnd = -1;
        this.mentionSearchToken += 1;

        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }
    }

    private extractMentionContext(value: string, caret: number): { query: string; start: number } | null {
        const prefix = value.slice(0, caret);
        const match = prefix.match(/(^|\s)@([\p{L}\p{N}_]{1,30})$/u);
        if (!match) {
            return null;
        }

        const query = match[2] ?? '';
        if (!query) {
            return null;
        }

        return {
            query,
            start: caret - query.length - 1
        };
    }

    private clearSelectedMedia(): void {
        for (const objectUrl of this.previewObjectUrls) {
            URL.revokeObjectURL(objectUrl);
        }

        if (this.croppedObjectUrl) {
            URL.revokeObjectURL(this.croppedObjectUrl);
        }

        this.croppedImageBlob = null;
        this.croppedObjectUrl = '';
        this.previewObjectUrls = [];
        this.selectedMediaFiles = [];
        this.mediaPreviewUrl = '';
        this.mediaPreviewUrls = [];
        this.mediaKind = 'none';
    }

    private buildUploadFiles(): File[] {
        if (this.selectedMediaFiles.length === 0) {
            return [];
        }

        if (this.mediaKind === 'multi-image') {
            return [...this.selectedMediaFiles];
        }

        const primaryFile = this.selectedMediaFiles[0];
        if (!primaryFile) {
            return [];
        }

        if (this.mediaKind !== 'image-croppable' || !this.croppedImageBlob) {
            return [primaryFile];
        }

        const baseName = primaryFile.name.replace(/\.[^.]+$/, '');
        const extension = this.cropOutputFormat === 'png' ? 'png' : 'jpg';
        const mimeType = this.croppedImageBlob.type || (this.cropOutputFormat === 'png' ? 'image/png' : 'image/jpeg');
        return [new File([this.croppedImageBlob], `${baseName}-crop.${extension}`, { type: mimeType })];
    }

    private normalizeContentLength(value: string): string {
        if (value.length <= this.maxContentLength) {
            return value;
        }

        return value.slice(0, this.maxContentLength);
    }
}