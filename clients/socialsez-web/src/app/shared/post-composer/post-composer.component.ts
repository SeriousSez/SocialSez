import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImageCroppedEvent, ImageCropperComponent, LoadedImage } from 'ngx-image-cropper';
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
    private previewObjectUrl = '';
    private croppedImageBlob: Blob | null = null;
    private croppedObjectUrl = '';

    constructor(private readonly session: SessionService) { }

    ngOnDestroy(): void {
        this.clearSelectedMedia();
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