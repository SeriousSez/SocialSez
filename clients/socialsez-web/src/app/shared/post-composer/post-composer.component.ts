import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImageCroppedEvent, ImageCropperComponent, LoadedImage } from 'ngx-image-cropper';
import { ProfileDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-post-composer',
    standalone: true,
    imports: [CommonModule, FormsModule, ImageCropperComponent],
    templateUrl: './post-composer.component.html',
    styleUrl: './post-composer.component.scss'
})
export class PostComposerComponent implements OnDestroy {
    @Input() showCancel = false;
    @Input() title = 'Compose';
    @Input() subtitle = 'Share a thought, launch update, or quick note.';

    @Output() posted = new EventEmitter<void>();
    @Output() canceled = new EventEmitter<void>();

    content = '';
    mediaPreviewUrl = '';
    status = '';
    uploadingMedia = false;
    mediaKind: 'none' | 'image-croppable' | 'image-static' | 'video' = 'none';
    cropOutputFormat: 'jpeg' | 'png' = 'jpeg';

    selectedMediaFile: File | null = null;
    mentionResults: ProfileDto[] = [];
    mentionOpen = false;
    mentionLoading = false;
    private previewObjectUrl = '';
    private croppedImageBlob: Blob | null = null;
    private croppedObjectUrl = '';
    private mentionRangeStart = -1;
    private mentionRangeEnd = -1;
    private mentionSearchDebounceId: number | null = null;
    private mentionSearchToken = 0;

    @ViewChild('composerTextarea')
    private composerTextareaRef?: ElementRef<HTMLTextAreaElement>;

    constructor(private readonly session: SessionService) { }

    ngOnDestroy(): void {
        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }

        this.clearSelectedMedia();
    }

    onContentInput(value: string, textarea: HTMLTextAreaElement): void {
        this.content = value;
        this.updateMentionSuggestions(value, textarea.selectionStart ?? value.length);
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
        this.content = `${this.content.slice(0, this.mentionRangeStart)}${replacement}${this.content.slice(this.mentionRangeEnd)}`;

        const nextCaret = this.mentionRangeStart + replacement.length;
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
        if ((!this.content.trim() && !this.selectedMediaFile) || this.uploadingMedia) {
            return;
        }

        this.uploadingMedia = true;
        this.status = '';

        try {
            const mediaFile = this.buildUploadFile();
            await this.session.createPostAsync(this.content.trim(), mediaFile ?? undefined);
            this.content = '';
            this.clearSelectedMedia();
            this.status = 'Posted.';
            this.posted.emit();
        } catch {
            this.status = 'Could not create post.';
        } finally {
            this.uploadingMedia = false;
        }
    }

    cancel(): void {
        if (this.uploadingMedia) {
            return;
        }

        this.content = '';
        this.clearSelectedMedia();
        this.status = '';
        this.canceled.emit();
    }

    onPostMediaSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) {
            return;
        }

        this.clearSelectedMedia();
        this.selectedMediaFile = file;
        this.previewObjectUrl = URL.createObjectURL(file);
        this.mediaPreviewUrl = this.previewObjectUrl;

        if (file.type.startsWith('video/')) {
            this.mediaKind = 'video';
            this.cropOutputFormat = 'jpeg';
            this.status = 'Video attached.';
        } else if (file.type === 'image/gif') {
            this.mediaKind = 'image-static';
            this.cropOutputFormat = 'jpeg';
            this.status = 'GIF attached. Cropping is disabled to preserve animation.';
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
        if (this.previewObjectUrl) {
            URL.revokeObjectURL(this.previewObjectUrl);
        }

        if (this.croppedObjectUrl) {
            URL.revokeObjectURL(this.croppedObjectUrl);
        }

        this.croppedImageBlob = null;
        this.croppedObjectUrl = '';
        this.previewObjectUrl = '';
        this.selectedMediaFile = null;
        this.mediaPreviewUrl = '';
        this.mediaKind = 'none';
    }

    private buildUploadFile(): File | undefined {
        if (!this.selectedMediaFile) {
            return undefined;
        }

        if (this.mediaKind !== 'image-croppable' || !this.croppedImageBlob) {
            return this.selectedMediaFile;
        }

        const baseName = this.selectedMediaFile.name.replace(/\.[^.]+$/, '');
        const extension = this.cropOutputFormat === 'png' ? 'png' : 'jpg';
        const mimeType = this.croppedImageBlob.type || (this.cropOutputFormat === 'png' ? 'image/png' : 'image/jpeg');
        return new File([this.croppedImageBlob], `${baseName}-crop.${extension}`, { type: mimeType });
    }
}