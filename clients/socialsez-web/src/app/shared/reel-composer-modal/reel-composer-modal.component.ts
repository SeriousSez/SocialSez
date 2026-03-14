import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';
import { ProfileDto } from '../../core/api.types';
import { environment } from '../../../environments/environment';
import { SessionService } from '../../core/session.service';
import { UploadProgressService } from '../../core/upload-progress.service';

interface ReelCoverOption {
    index: number;
    timeSeconds: number;
    blob: Blob;
    previewUrl: string;
}

interface LocationSuggestion {
    placeId: string;
    description: string;
    secondaryText: string;
}

interface NominatimResult {
    place_id?: number;
    display_name?: string;
    name?: string;
    type?: string;
    class?: string;
    addresstype?: string;
    address?: {
        country?: string;
    };
}

export interface ReelUploadStatusEvent {
    state: 'uploading' | 'success' | 'failed';
    message: string;
}

@Component({
    selector: 'app-reel-composer-modal',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './reel-composer-modal.component.html',
    styleUrl: './reel-composer-modal.component.scss'
})
export class ReelComposerModalComponent implements OnDestroy {
    private static readonly FrameOffsetLimit = 50;
    private static readonly CropFrameHeightPercent = 100;
    private static readonly ReelOutputAspect = 9 / 16;
    private static readonly MaxTrimDurationSeconds = 180;
    private static readonly CloseAnimationDurationMs = 180;
    private static readonly ReelCoverFrameCount = 9;
    private static readonly ReelOutputWidth = 540;
    private static readonly ReelOutputFps = 24;
    private readonly draftStorageKey = 'socialsez.reel-composer.draft.v1';

    @Input()
    set open(value: boolean) {
        if (value === this._open) {
            return;
        }

        this._open = value;
        if (value) {
            if (this.closeAnimationTimerId !== null) {
                window.clearTimeout(this.closeAnimationTimerId);
                this.closeAnimationTimerId = null;
            }

            this.isClosing = false;
            this.isRendered = true;
            this.restoreDraft();
            return;
        }

        this.beginCloseAnimation(false);
    }

    get open(): boolean {
        return this._open;
    }
    @ViewChild('reelPreviewVideo') private readonly reelPreviewVideoRef?: ElementRef<HTMLVideoElement>;
    @ViewChild('reelVideoInput') private readonly reelVideoInputRef?: ElementRef<HTMLInputElement>;
    @ViewChild('reelThumbnailInput') private readonly reelThumbnailInputRef?: ElementRef<HTMLInputElement>;

    @Output() closed = new EventEmitter<void>();
    @Output() published = new EventEmitter<void>();
    @Output() uploadStatus = new EventEmitter<ReelUploadStatusEvent>();

    reelCaption = '';
    reelLocation = '';
    reelCollaborators = '';
    markSensitive = false;
    reelComposerStep: 1 | 2 = 1;
    isRendered = false;
    isClosing = false;
    reelVideoFile: File | null = null;
    reelThumbnailFile: File | null = null;
    reelVideoPreviewUrl = '';
    reelVideoDurationSeconds = 0;
    reelPreviewReady = false;
    reelTrimStartSeconds = 0;
    reelTrimEndSeconds = 0;
    reelCoverOptions: ReelCoverOption[] = [];
    reelTrimPreviewOptions: ReelCoverOption[] = [];
    generatingReelCovers = false;
    selectedReelCoverIndex = 0;
    reelSourceVideoWidth = 0;
    reelSourceVideoHeight = 0;
    reelFrameZoom = 1;
    reelFrameOffsetX = 0;
    reelFrameOffsetY = 0;
    postingReel = false;
    reelComposerError = '';
    locationSuggestions: LocationSuggestion[] = [];
    showLocationSuggestions = false;
    loadingLocationSuggestions = false;
    locationHint = 'Type at least 2 characters to search locations.';
    collaboratorSuggestions: ProfileDto[] = [];
    showCollaboratorSuggestions = false;
    collaboratorsHint = 'Collaborators can be separated by commas.';
    private draggingTrimPart: 'start' | 'end' | 'range' | null = null;
    private dragOriginClientX = 0;
    private dragOriginStartSeconds = 0;
    private dragOriginEndSeconds = 0;
    private dragTrackWidth = 1;
    private locationSearchDebounceId: number | null = null;
    private locationSearchToken = 0;
    private collaboratorSearchDebounceId: number | null = null;
    private collaboratorSearchToken = 0;
    private frameCoverRefreshToken = 0;
    private placesAutocompleteService: any | null = null;
    private googlePlacesLoadPromise: Promise<boolean> | null = null;
    private draggingFrame = false;
    private frameDragOriginClientX = 0;
    private frameDragOriginClientY = 0;
    private frameDragOriginOffsetX = 0;
    private frameDragOriginOffsetY = 0;
    private frameDragViewportWidth = 1;
    private frameDragViewportHeight = 1;
    private readonly onGlobalPointerMove = (event: PointerEvent) => {
        this.handleTrimPointerMove(event);
    };
    private readonly onGlobalPointerUp = () => {
        this.stopTrimDragging();
    };
    private readonly onFramePointerMove = (event: PointerEvent) => {
        this.handleFramePointerMove(event);
    };
    private readonly onFramePointerUp = () => {
        this.stopFrameDragging();
    };
    private _open = false;
    private closeAnimationTimerId: number | null = null;

    constructor(
        private readonly session: SessionService,
        private readonly ngZone: NgZone,
        private readonly uploadProgress: UploadProgressService
    ) { }

    ngOnDestroy(): void {
        this.clearReelComposerMedia();
        this.detachTrimDragListeners();
        this.detachFrameDragListeners();
        this.closeLocationSuggestions();
        this.closeCollaboratorSuggestions();
        if (this.closeAnimationTimerId !== null) {
            window.clearTimeout(this.closeAnimationTimerId);
            this.closeAnimationTimerId = null;
        }
    }

    onBackdropClick(event: MouseEvent): void {
        if (event.target !== event.currentTarget) {
            return;
        }

        this.cancel();
    }

    close(): void {
        this.cancel();
    }

    openVideoPicker(): void {
        this.reelVideoInputRef?.nativeElement.click();
    }

    goBackToVideoSelection(): void {
        if (this.postingReel) {
            return;
        }

        this.clearReelComposerMedia();
        this.reelComposerError = '';
        this.reelPreviewReady = false;
        this.generatingReelCovers = false;
    }

    openThumbnailPicker(): void {
        if (!this.reelPreviewReady) {
            return;
        }

        this.reelThumbnailInputRef?.nativeElement.click();
    }

    goToStep(step: 1 | 2): void {
        if (step === 2 && !this.reelVideoFile) {
            this.reelComposerError = 'Choose video first to continue.';
            return;
        }

        this.reelComposerError = '';
        this.reelComposerStep = step;
    }

    cancel(): void {
        if (this.postingReel) {
            return;
        }

        this.beginCloseAnimation(true, true);
    }

    private beginCloseAnimation(emitClosed: boolean, resetAfterClose = false): void {
        if (!this.isRendered) {
            if (resetAfterClose) {
                this.resetComposer();
            }
            if (emitClosed) {
                this.closed.emit();
            }
            return;
        }

        if (this.isClosing) {
            return;
        }

        this.isClosing = true;

        if (this.closeAnimationTimerId !== null) {
            window.clearTimeout(this.closeAnimationTimerId);
        }

        this.closeAnimationTimerId = window.setTimeout(() => {
            this.isClosing = false;
            this.isRendered = false;
            this.closeAnimationTimerId = null;

            if (resetAfterClose) {
                this.resetComposer();
            }

            if (emitClosed) {
                this.closed.emit();
            }
        }, ReelComposerModalComponent.CloseAnimationDurationMs);
    }

    async onVideoSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        if (!file) {
            return;
        }

        this.reelComposerError = '';
        this.clearReelVideoSelection();
        this.reelPreviewReady = false;
        this.generatingReelCovers = false;

        this.reelVideoFile = file;
        this.reelVideoPreviewUrl = URL.createObjectURL(file);

        try {
            this.reelVideoDurationSeconds = await this.readVideoDurationSeconds(file);
            this.reelTrimStartSeconds = 0;
            this.reelTrimEndSeconds = Math.min(this.reelVideoDurationSeconds, ReelComposerModalComponent.MaxTrimDurationSeconds);
        } catch {
            this.reelComposerError = 'Could not process this video. Please pick a different file.';
            this.clearReelVideoSelection();
        }

        if (this.reelVideoFile) {
            this.reelComposerStep = 1;
        }

        if (input) {
            input.value = '';
        }
    }

    async onThumbnailSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        this.reelComposerError = '';

        if (!file) {
            this.reelThumbnailFile = null;
            if (input) {
                input.value = '';
            }
            return;
        }

        try {
            this.reelThumbnailFile = await this.normalizeCustomThumbnailFile(file);
        } catch {
            this.reelComposerError = 'Could not process this thumbnail. Please choose a different image.';
            this.reelThumbnailFile = null;
        }

        if (input) {
            input.value = '';
        }
    }

    onLocationInput(rawValue: string): void {
        this.reelLocation = rawValue;
        this.updateLocationSuggestions(rawValue);
        this.persistDraft();
    }

    onLocationFocus(): void {
        this.updateLocationSuggestions(this.reelLocation, true);
    }

    onLocationBlur(): void {
        window.setTimeout(() => {
            this.showLocationSuggestions = false;
        }, 120);
    }

    selectLocationSuggestion(suggestion: LocationSuggestion): void {
        this.reelLocation = suggestion.description;
        this.closeLocationSuggestions();
        this.persistDraft();
    }

    onCollaboratorsInput(rawValue: string): void {
        this.reelCollaborators = rawValue;
        this.updateCollaboratorSuggestions(rawValue);
        this.persistDraft();
    }

    onCollaboratorsFocus(): void {
        this.updateCollaboratorSuggestions(this.reelCollaborators, true);
    }

    onCollaboratorsBlur(): void {
        window.setTimeout(() => {
            this.showCollaboratorSuggestions = false;
        }, 120);
    }

    selectCollaboratorSuggestion(profile: ProfileDto): void {
        this.reelCollaborators = this.replaceCurrentCollaboratorToken(this.reelCollaborators, `@${profile.handle}`);
        this.closeCollaboratorSuggestions();
        this.persistDraft();
    }

    onCaptionInput(rawValue: string): void {
        this.reelCaption = rawValue;
        this.persistDraft();
    }

    onSensitiveToggleChanged(value: boolean): void {
        this.markSensitive = value;
        this.persistDraft();
    }

    onTrimStartChanged(rawValue: string): void {
        const next = Number(rawValue);
        if (Number.isNaN(next)) {
            return;
        }

        const minStart = Math.max(0, this.reelTrimEndSeconds - ReelComposerModalComponent.MaxTrimDurationSeconds);
        this.reelTrimStartSeconds = Math.max(minStart, Math.min(next, this.reelTrimEndSeconds - 1));
        this.syncPreviewToTrimRange();
    }

    onTrimEndChanged(rawValue: string): void {
        const next = Number(rawValue);
        if (Number.isNaN(next)) {
            return;
        }

        const maxEnd = Math.min(this.reelVideoDurationSeconds, this.reelTrimStartSeconds + ReelComposerModalComponent.MaxTrimDurationSeconds);
        this.reelTrimEndSeconds = Math.max(this.reelTrimStartSeconds + 1, Math.min(next, maxEnd));
        this.syncPreviewToTrimRange();
    }

    onPreviewLoadedMetadata(): void {
        const preview = this.reelPreviewVideoRef?.nativeElement;
        if (preview) {
            const parsedDuration = Number.isFinite(preview.duration) ? Math.round(preview.duration) : 0;
            if (parsedDuration > 0) {
                this.reelVideoDurationSeconds = parsedDuration;
                this.reelTrimStartSeconds = Math.max(0, Math.min(this.reelTrimStartSeconds, parsedDuration - 1));
                const defaultEnd = this.reelTrimEndSeconds || parsedDuration;
                const maxEnd = Math.min(parsedDuration, this.reelTrimStartSeconds + ReelComposerModalComponent.MaxTrimDurationSeconds);
                this.reelTrimEndSeconds = Math.max(this.reelTrimStartSeconds + 1, Math.min(defaultEnd, maxEnd));
                if (this.reelTrimEndSeconds - this.reelTrimStartSeconds > ReelComposerModalComponent.MaxTrimDurationSeconds) {
                    this.reelTrimEndSeconds = Math.min(parsedDuration, this.reelTrimStartSeconds + ReelComposerModalComponent.MaxTrimDurationSeconds);
                }
            }

            this.reelSourceVideoWidth = preview.videoWidth || 0;
            this.reelSourceVideoHeight = preview.videoHeight || 0;
        }

        this.reelPreviewReady = true;
        this.syncPreviewToTrimRange(true);

        if (!this.reelVideoFile || this.reelVideoDurationSeconds <= 0 || this.generatingReelCovers || this.reelCoverOptions.length) {
            return;
        }

        this.generatingReelCovers = true;
        void this.generateReelCoverOptions(this.reelVideoFile, this.reelVideoDurationSeconds)
            .catch(() => {
                this.reelComposerError = 'Could not generate suggested thumbnails for this video.';
            })
            .finally(() => {
                this.generatingReelCovers = false;
            });
    }

    onFrameZoomChanged(rawValue: string): void {
        const next = Number(rawValue);
        if (Number.isNaN(next)) {
            return;
        }

        this.reelFrameZoom = Math.max(1, Math.min(2.5, Number(next.toFixed(2))));
        this.reelFrameOffsetX = this.clampFrameOffset(this.reelFrameOffsetX);
        this.reelFrameOffsetY = this.clampFrameOffset(this.reelFrameOffsetY);
    }

    resetFramePosition(refreshCovers = true): void {
        this.reelFrameZoom = 1;
        this.reelFrameOffsetX = 0;
        this.reelFrameOffsetY = 0;

        if (!refreshCovers) {
            return;
        }

        void this.refreshCoverOptionsForCurrentFrame();
    }

    onFramePointerDown(event: PointerEvent, viewport: HTMLElement): void {
        if (!this.reelVideoFile) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.draggingFrame = true;
        this.frameDragOriginClientX = event.clientX;
        this.frameDragOriginClientY = event.clientY;
        this.frameDragOriginOffsetX = this.reelFrameOffsetX;
        this.frameDragOriginOffsetY = this.reelFrameOffsetY;
        const bounds = viewport.getBoundingClientRect();
        this.frameDragViewportWidth = Math.max(1, bounds.width);
        this.frameDragViewportHeight = Math.max(1, bounds.height);
        this.attachFrameDragListeners();
    }

    onPreviewPlay(): void {
        const preview = this.reelPreviewVideoRef?.nativeElement;
        if (!preview) {
            return;
        }

        if (preview.currentTime < this.reelTrimStartSeconds || preview.currentTime >= this.reelTrimEndSeconds) {
            preview.currentTime = this.reelTrimStartSeconds;
        }
    }

    onPreviewSeeking(): void {
        this.syncPreviewToTrimRange();
    }

    onPreviewTimeUpdate(): void {
        const preview = this.reelPreviewVideoRef?.nativeElement;
        if (!preview) {
            return;
        }

        if (preview.currentTime >= this.reelTrimEndSeconds) {
            preview.currentTime = this.reelTrimStartSeconds;
            if (!preview.paused) {
                void preview.play().catch(() => {
                    // ignored: user gesture may be required
                });
            }
        }
    }

    onTrimHandlePointerDown(event: PointerEvent, part: 'start' | 'end', track: HTMLElement): void {
        if (this.reelVideoDurationSeconds <= 1) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.beginTrimDragging(part, event.clientX, track);
    }

    onTrimRangePointerDown(event: PointerEvent, track: HTMLElement): void {
        if (this.reelVideoDurationSeconds <= 1) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.beginTrimDragging('range', event.clientX, track);
    }

    get trimStartPercent(): number {
        if (this.reelVideoDurationSeconds <= 0) {
            return 0;
        }

        return (this.reelTrimStartSeconds / this.reelVideoDurationSeconds) * 100;
    }

    get trimEndPercent(): number {
        if (this.reelVideoDurationSeconds <= 0) {
            return 100;
        }

        return (this.reelTrimEndSeconds / this.reelVideoDurationSeconds) * 100;
    }

    chooseGeneratedCover(index: number): void {
        this.selectedReelCoverIndex = index;
        this.reelThumbnailFile = null;
    }

    async publish(): Promise<void> {
        if (!this.reelVideoFile || this.postingReel) {
            return;
        }

        this.postingReel = true;
        this.reelComposerError = '';

        // Close immediately and continue processing/upload in the background.
        this.uploadStatus.emit({
            state: 'uploading',
            message: 'Reel is uploading. You can keep browsing while it finishes.'
        });
        this.closed.emit();

        const handle = this.uploadProgress.begin('Uploading reel...');
        const session = this.session;
        const uploadStatus = this.uploadStatus;
        const published = this.published;

        void (async () => {
            try {
                const uploadVideo = await this.buildTrimmedVideoOrOriginal(this.reelVideoFile!);
                const durationSeconds = Math.max(1, Math.min(180, Math.round(this.reelTrimEndSeconds - this.reelTrimStartSeconds)));
                const generatedCover = this.reelCoverOptions.find(option => option.index === this.selectedReelCoverIndex);
                const thumbnail = this.reelThumbnailFile
                    ?? (generatedCover
                        ? new File([generatedCover.blob], `reel-cover-${Date.now()}.jpg`, { type: generatedCover.blob.type || 'image/jpeg' })
                        : undefined);
                const captionPayload = this.buildReelCaptionPayload();
                const isSensitive = this.markSensitive;

                this.resetComposer();

                await session.createReelAsync(uploadVideo, durationSeconds, captionPayload, thumbnail, isSensitive);
                this.clearDraft();
                published.emit();
                handle.succeed('Reel uploaded!');
                uploadStatus.emit({
                    state: 'success',
                    message: 'Reel uploaded successfully.'
                });
            } catch {
                handle.fail('Reel upload failed');
                uploadStatus.emit({
                    state: 'failed',
                    message: 'Reel upload failed. Please try again.'
                });
            } finally {
                this.postingReel = false;
            }
        })();
    }

    get reelTrimmedDurationLabel(): string {
        return `${Math.max(1, Math.round(this.reelTrimEndSeconds - this.reelTrimStartSeconds))}s`;
    }

    get reelFrameTransform(): string {
        return `translate(${this.reelFrameOffsetX}%, ${this.reelFrameOffsetY}%) scale(${this.reelFrameZoom})`;
    }

    get reelCropFrameStyle(): Record<string, string> {
        const frameHeightPercent = ReelComposerModalComponent.CropFrameHeightPercent;
        const frameWidthPercent = frameHeightPercent * (9 / 16) * (9 / 16);
        const maxCenterShiftX = Math.max(0, (100 - frameWidthPercent) / 2);
        const maxCenterShiftY = Math.max(0, (100 - frameHeightPercent) / 2);
        const offsetLimit = ReelComposerModalComponent.FrameOffsetLimit;
        const shiftX = (this.reelFrameOffsetX / offsetLimit) * maxCenterShiftX;
        const shiftY = (this.reelFrameOffsetY / offsetLimit) * maxCenterShiftY;

        return {
            height: `${frameHeightPercent}%`,
            left: `${50 + shiftX}%`,
            top: `${50 + shiftY}%`
        };
    }

    get isFrameDragging(): boolean {
        return this.draggingFrame;
    }

    get reelPublishPreviewVideoStyle(): Record<string, string> {
        if (!this.reelSourceVideoWidth || !this.reelSourceVideoHeight) {
            return {
                width: '100%',
                height: '100%',
                left: '0%',
                top: '0%'
            };
        }

        const crop = this.getFrameCropForSource(this.reelSourceVideoWidth, this.reelSourceVideoHeight);
        const widthPercent = (this.reelSourceVideoWidth / crop.width) * 100;
        const heightPercent = (this.reelSourceVideoHeight / crop.height) * 100;
        const leftPercent = -((crop.x / crop.width) * 100);
        const topPercent = -((crop.y / crop.height) * 100);

        return {
            width: `${widthPercent}%`,
            height: `${heightPercent}%`,
            left: `${leftPercent}%`,
            top: `${topPercent}%`
        };
    }

    private resetComposer(): void {
        this.reelCaption = '';
        this.reelLocation = '';
        this.reelCollaborators = '';
        this.markSensitive = false;
        this.reelComposerStep = 1;
        this.locationHint = 'Type at least 2 characters to search locations.';
        this.loadingLocationSuggestions = false;
        this.collaboratorsHint = 'Collaborators can be separated by commas.';
        this.clearReelComposerMedia();
        this.closeLocationSuggestions();
        this.closeCollaboratorSuggestions();
        this.reelComposerError = '';
        this.reelPreviewReady = false;
        this.generatingReelCovers = false;
        this.resetFramePosition(false);
    }

    private persistDraft(): void {
        const hasDraft = !!this.reelCaption.trim()
            || !!this.reelLocation.trim()
            || !!this.reelCollaborators.trim()
            || this.markSensitive;

        if (!hasDraft) {
            localStorage.removeItem(this.draftStorageKey);
            return;
        }

        localStorage.setItem(this.draftStorageKey, JSON.stringify({
            reelCaption: this.reelCaption,
            reelLocation: this.reelLocation,
            reelCollaborators: this.reelCollaborators,
            markSensitive: this.markSensitive
        }));
    }

    private restoreDraft(): void {
        const raw = localStorage.getItem(this.draftStorageKey);
        if (!raw) {
            return;
        }

        try {
            const parsed = JSON.parse(raw) as {
                reelCaption?: string;
                reelLocation?: string;
                reelCollaborators?: string;
                markSensitive?: boolean;
            };

            this.reelCaption = parsed.reelCaption ?? '';
            this.reelLocation = parsed.reelLocation ?? '';
            this.reelCollaborators = parsed.reelCollaborators ?? '';
            this.markSensitive = parsed.markSensitive === true;
        } catch {
            localStorage.removeItem(this.draftStorageKey);
        }
    }

    private clearDraft(): void {
        localStorage.removeItem(this.draftStorageKey);
    }

    private clearReelComposerMedia(): void {
        this.clearReelVideoSelection();
        this.reelThumbnailFile = null;
    }

    private clearReelVideoSelection(): void {
        const preview = this.reelPreviewVideoRef?.nativeElement;
        if (preview) {
            preview.pause();
        }

        if (this.reelVideoPreviewUrl) {
            URL.revokeObjectURL(this.reelVideoPreviewUrl);
        }

        for (const option of this.reelCoverOptions) {
            URL.revokeObjectURL(option.previewUrl);
        }

        for (const option of this.reelTrimPreviewOptions) {
            URL.revokeObjectURL(option.previewUrl);
        }

        this.reelVideoPreviewUrl = '';
        this.reelVideoFile = null;
        this.reelVideoDurationSeconds = 0;
        this.reelPreviewReady = false;
        this.reelTrimStartSeconds = 0;
        this.reelTrimEndSeconds = 0;
        this.reelCoverOptions = [];
        this.reelTrimPreviewOptions = [];
        this.selectedReelCoverIndex = 0;
        this.reelSourceVideoWidth = 0;
        this.reelSourceVideoHeight = 0;
        this.generatingReelCovers = false;
        this.resetFramePosition(false);
    }

    private async readVideoDurationSeconds(file: File): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.src = url;

            const cleanup = () => {
                URL.revokeObjectURL(url);
                video.removeAttribute('src');
                video.load();
            };

            video.onloadedmetadata = () => {
                const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
                cleanup();
                if (duration <= 0) {
                    reject(new Error('Invalid video duration.'));
                    return;
                }

                resolve(duration);
            };

            video.onerror = () => {
                cleanup();
                reject(new Error('Could not read video metadata.'));
            };
        });
    }

    private async generateReelCoverOptions(file: File, durationSeconds: number): Promise<void> {
        for (const option of this.reelCoverOptions) {
            URL.revokeObjectURL(option.previewUrl);
        }

        for (const option of this.reelTrimPreviewOptions) {
            URL.revokeObjectURL(option.previewUrl);
        }

        const frameCount = Math.min(ReelComposerModalComponent.ReelCoverFrameCount, Math.max(3, durationSeconds >= 12 ? ReelComposerModalComponent.ReelCoverFrameCount : 3));
        const coverOptions: ReelCoverOption[] = [];
        const trimOptions: ReelCoverOption[] = [];

        for (let index = 0; index < frameCount; index += 1) {
            const ratio = frameCount === 1 ? 0 : index / (frameCount - 1);
            const timeSeconds = Math.max(0, Math.min(durationSeconds - 0.1, durationSeconds * ratio));
            const trimBlob = await this.captureVideoFrame(file, timeSeconds, false);
            const trimPreviewUrl = URL.createObjectURL(trimBlob);
            trimOptions.push({ index, timeSeconds, blob: trimBlob, previewUrl: trimPreviewUrl });

            const coverBlob = await this.captureVideoFrame(file, timeSeconds, true);
            const coverPreviewUrl = URL.createObjectURL(coverBlob);
            coverOptions.push({ index, timeSeconds, blob: coverBlob, previewUrl: coverPreviewUrl });
        }

        this.runInZone(() => {
            this.reelTrimPreviewOptions = trimOptions;
            this.reelCoverOptions = coverOptions;
            this.selectedReelCoverIndex = coverOptions[0]?.index ?? 0;
        });
    }

    private async captureVideoFrame(file: File, timeSeconds: number, useFrameCrop = true): Promise<Blob> {
        return new Promise<Blob>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.preload = 'auto';
            video.muted = true;
            video.src = url;

            const cleanup = () => {
                URL.revokeObjectURL(url);
                video.removeAttribute('src');
                video.load();
            };

            video.onloadedmetadata = () => {
                video.currentTime = Math.max(0, Math.min(timeSeconds, Math.max(0, video.duration - 0.1)));
            };

            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                const width = video.videoWidth || 720;
                const height = video.videoHeight || 1280;
                const crop = useFrameCrop
                    ? this.getFrameCropForSource(width, height)
                    : { x: 0, y: 0, width, height };
                canvas.width = crop.width;
                canvas.height = crop.height;

                const context = canvas.getContext('2d');
                if (!context) {
                    cleanup();
                    reject(new Error('Could not capture frame context.'));
                    return;
                }

                context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
                canvas.toBlob(blob => {
                    cleanup();
                    if (!blob) {
                        reject(new Error('Could not capture frame image.'));
                        return;
                    }

                    resolve(blob);
                }, 'image/jpeg', 0.85);
            };

            video.onerror = () => {
                cleanup();
                reject(new Error('Could not load video for frame capture.'));
            };
        });
    }

    private async buildTrimmedVideoOrOriginal(file: File): Promise<File> {
        const trimStart = Math.max(0, Math.floor(this.reelTrimStartSeconds));
        const trimEnd = Math.max(trimStart + 1, Math.ceil(this.reelTrimEndSeconds));
        const fullDuration = Math.max(1, Math.round(this.reelVideoDurationSeconds));
        const hasFrameCrop = Math.abs(this.reelFrameOffsetX) > 0.5 || Math.abs(this.reelFrameOffsetY) > 0.5;

        if (trimStart <= 0 && trimEnd >= fullDuration && !hasFrameCrop) {
            return file;
        }

        if (!('MediaRecorder' in window)) {
            this.reelComposerError = 'Trim preview saved, but your browser uploaded the full video because MediaRecorder is not available.';
            return file;
        }

        return new Promise<File>((resolve) => {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.src = url;
            video.muted = false;
            video.volume = 0;
            video.playsInline = true;

            const cleanup = () => {
                URL.revokeObjectURL(url);
                video.pause();
                video.removeAttribute('src');
                video.load();
            };

            video.onloadedmetadata = async () => {
                try {
                    const sourceWidth = video.videoWidth || 720;
                    const sourceHeight = video.videoHeight || 1280;
                    const crop = this.getFrameCropForSource(sourceWidth, sourceHeight);
                    const outputWidth = ReelComposerModalComponent.ReelOutputWidth;
                    const outputHeight = Math.max(1, Math.round(outputWidth / ReelComposerModalComponent.ReelOutputAspect));

                    const canvas = document.createElement('canvas');
                    canvas.width = outputWidth;
                    canvas.height = outputHeight;

                    const context = canvas.getContext('2d');
                    if (!context) {
                        this.reelComposerError = 'Could not apply framing to trimmed video. Uploaded original instead.';
                        cleanup();
                        resolve(file);
                        return;
                    }

                    const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(ReelComposerModalComponent.ReelOutputFps);
                    if (!stream) {
                        this.reelComposerError = 'Trim preview saved, but this browser does not support video trimming upload.';
                        cleanup();
                        resolve(file);
                        return;
                    }

                    const sourceStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }).captureStream?.()
                        ?? (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();
                    const sourceAudioTracks = sourceStream?.getAudioTracks() ?? [];
                    for (const track of sourceAudioTracks) {
                        stream.addTrack(track);
                    }

                    const chunks: BlobPart[] = [];
                    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
                        ? 'video/webm;codecs=vp8'
                        : 'video/webm';

                    const recorder = new MediaRecorder(stream, { mimeType });
                    let drawFrameId = 0;
                    let stopCheckId = 0;

                    const drawFrame = () => {
                        context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, outputWidth, outputHeight);
                        if (!video.paused && !video.ended) {
                            drawFrameId = window.requestAnimationFrame(drawFrame);
                        }
                    };

                    const monitorStop = () => {
                        if (video.currentTime >= trimEnd || video.ended) {
                            window.cancelAnimationFrame(drawFrameId);
                            video.pause();
                            recorder.stop();
                            return;
                        }

                        stopCheckId = window.requestAnimationFrame(monitorStop);
                    };

                    recorder.ondataavailable = event => {
                        if (event.data && event.data.size > 0) {
                            chunks.push(event.data);
                        }
                    };

                    recorder.onstop = () => {
                        window.cancelAnimationFrame(drawFrameId);
                        window.cancelAnimationFrame(stopCheckId);
                        cleanup();
                        if (!chunks.length) {
                            resolve(file);
                            return;
                        }

                        const blob = new Blob(chunks, { type: mimeType });
                        resolve(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-trim.webm`, { type: mimeType }));
                    };

                    video.onseeked = async () => {
                        recorder.start(250);
                        await video.play();
                        drawFrame();
                        monitorStop();
                    };

                    video.currentTime = trimStart;
                } catch {
                    cleanup();
                    this.reelComposerError = 'Trim preview saved, but upload used original video due to processing limits.';
                    resolve(file);
                }
            };

            video.onerror = () => {
                cleanup();
                resolve(file);
            };
        });
    }

    private buildReelCaptionPayload(): string {
        const parts: string[] = [];
        const location = this.reelLocation.trim();
        const collaborators = this.reelCollaborators
            .split(',')
            .map(value => value.trim())
            .filter(value => !!value)
            .map(value => value.startsWith('@') ? value : `@${value}`);
        const caption = this.reelCaption.trim();

        if (location) {
            parts.push(`📍 ${location}`);
        }

        if (collaborators.length) {
            parts.push(`🤝 ${collaborators.join(' ')}`);
        }

        if (caption) {
            parts.push(caption);
        }

        return parts.join('\n').trim();
    }

    private async updateLocationSuggestions(rawValue: string, immediate = false): Promise<void> {
        const query = rawValue.trim();
        if (query.length < 2) {
            this.closeLocationSuggestions();
            this.locationHint = 'Type at least 2 characters to search locations.';
            return;
        }

        this.loadingLocationSuggestions = true;
        this.locationHint = 'Searching locations...';

        if (this.locationSearchDebounceId !== null) {
            window.clearTimeout(this.locationSearchDebounceId);
            this.locationSearchDebounceId = null;
        }

        const token = ++this.locationSearchToken;
        this.locationSearchDebounceId = window.setTimeout(async () => {
            this.locationSearchDebounceId = null;

            const ready = await this.ensurePlacesAutocompleteReady();
            if (token !== this.locationSearchToken) {
                return;
            }

            if (!ready || !this.placesAutocompleteService) {
                try {
                    const fallbackSuggestions = await this.getFallbackLocationSuggestions(query);
                    if (token !== this.locationSearchToken) {
                        return;
                    }

                    this.runInZone(() => {
                        this.loadingLocationSuggestions = false;
                        this.locationSuggestions = fallbackSuggestions;
                        this.showLocationSuggestions = fallbackSuggestions.length > 0;
                        this.locationHint = fallbackSuggestions.length
                            ? 'Google Places unavailable. Showing fallback location suggestions.'
                            : 'No location suggestions found. Verify Google key restrictions or try a broader query.';
                    });
                    return;
                } catch {
                    if (token !== this.locationSearchToken) {
                        return;
                    }

                    this.runInZone(() => {
                        this.loadingLocationSuggestions = false;
                        this.locationSuggestions = [];
                        this.showLocationSuggestions = false;
                        this.locationHint = 'Location services are unavailable right now. Check your Google key restrictions.';
                    });
                    return;
                }
            }

            try {
                const suggestions = await this.getLocationPredictions(query);
                if (token !== this.locationSearchToken) {
                    return;
                }

                this.runInZone(() => {
                    this.loadingLocationSuggestions = false;
                    this.locationSuggestions = suggestions;
                    this.showLocationSuggestions = suggestions.length > 0;
                    this.locationHint = suggestions.length
                        ? 'Select a location from suggestions.'
                        : 'No location suggestions found. Check API key restrictions if this seems wrong.';
                });
            } catch {
                if (token !== this.locationSearchToken) {
                    return;
                }

                this.runInZone(() => {
                    this.loadingLocationSuggestions = false;
                    this.locationSuggestions = [];
                    this.showLocationSuggestions = false;
                    this.locationHint = 'Could not fetch location suggestions right now.';
                });
            }
        }, immediate ? 0 : 220);
    }

    private async getLocationPredictions(query: string): Promise<LocationSuggestion[]> {
        return new Promise<LocationSuggestion[]>(resolve => {
            this.placesAutocompleteService.getPlacePredictions(
                { input: query },
                (predictions: any[] | null, status: string) => {
                    if (status !== 'OK' || !predictions?.length) {
                        resolve([]);
                        return;
                    }

                    const filtered = predictions
                        .filter(prediction => this.isGoogleSuggestionAllowed(prediction.types ?? []))
                        .slice(0, 6)
                        .map(prediction => this.mapGoogleSuggestion(prediction));

                    resolve(filtered);
                }
            );
        });
    }

    private async getFallbackLocationSuggestions(query: string): Promise<LocationSuggestion[]> {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=12&q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json() as NominatimResult[];
        return data
            .filter(item => this.isFallbackSuggestionAllowed(item))
            .slice(0, 6)
            .map(item => this.mapFallbackSuggestion(item));
    }

    private isGoogleSuggestionAllowed(types: string[]): boolean {
        const cityTypes = new Set([
            'locality',
            'postal_town',
            'administrative_area_level_3',
            'administrative_area_level_2',
            'country'
        ]);
        const poiTypes = new Set([
            'point_of_interest',
            'establishment',
            'tourist_attraction',
            'natural_feature',
            'park',
            'museum',
            'airport',
            'stadium',
            'zoo',
            'aquarium',
            'art_gallery',
            'shopping_mall',
            'premise'
        ]);

        return types.some(type => cityTypes.has(type) || poiTypes.has(type));
    }

    private isGooglePoi(types: string[]): boolean {
        const poiTypes = new Set([
            'point_of_interest',
            'establishment',
            'tourist_attraction',
            'natural_feature',
            'park',
            'museum',
            'airport',
            'stadium',
            'zoo',
            'aquarium',
            'art_gallery',
            'shopping_mall',
            'premise'
        ]);

        return types.some(type => poiTypes.has(type));
    }

    private mapGoogleSuggestion(prediction: any): LocationSuggestion {
        const types: string[] = prediction.types ?? [];
        const mainText = prediction.structured_formatting?.main_text ?? prediction.description ?? '';
        const secondaryText = prediction.structured_formatting?.secondary_text ?? '';
        const country = secondaryText
            .split(',')
            .map((part: string) => part.trim())
            .filter((part: string) => !!part)
            .at(-1) ?? '';
        const isPoi = this.isGooglePoi(types);

        const description = isPoi
            ? (country ? `${mainText}, ${country}` : mainText)
            : (country ? `${mainText}, ${country}` : mainText);

        return {
            placeId: prediction.place_id,
            description,
            secondaryText: isPoi ? 'Point of interest' : 'City / country'
        };
    }

    private isFallbackSuggestionAllowed(item: NominatimResult): boolean {
        const placeType = (item.type ?? '').toLowerCase();
        const placeClass = (item.class ?? '').toLowerCase();
        const addressType = (item.addresstype ?? '').toLowerCase();

        const cityTypes = new Set(['city', 'town', 'village', 'municipality', 'county', 'state', 'country']);
        const poiTypes = new Set([
            'attraction',
            'museum',
            'park',
            'stadium',
            'airport',
            'hotel',
            'mall',
            'zoo',
            'aquarium',
            'gallery',
            'monument'
        ]);
        const poiClasses = new Set(['tourism', 'amenity', 'leisure', 'historic', 'shop']);

        return cityTypes.has(placeType)
            || cityTypes.has(addressType)
            || poiTypes.has(placeType)
            || poiClasses.has(placeClass);
    }

    private mapFallbackSuggestion(item: NominatimResult): LocationSuggestion {
        const placeType = (item.type ?? '').toLowerCase();
        const placeClass = (item.class ?? '').toLowerCase();
        const displayName = item.display_name ?? item.name ?? '';
        const main = item.name?.trim() || displayName.split(',')[0]?.trim() || displayName;
        const country = item.address?.country?.trim() ?? displayName.split(',').at(-1)?.trim() ?? '';
        const isPoi = ['tourism', 'amenity', 'leisure', 'historic', 'shop'].includes(placeClass)
            || ['attraction', 'museum', 'park', 'stadium', 'airport', 'hotel', 'mall', 'zoo', 'aquarium', 'gallery', 'monument'].includes(placeType);

        return {
            placeId: `${item.place_id ?? item.display_name}`,
            description: country && main ? `${main}, ${country}` : (main || displayName),
            secondaryText: isPoi ? 'Point of interest' : 'City / country'
        };
    }

    private async ensurePlacesAutocompleteReady(): Promise<boolean> {
        if (this.placesAutocompleteService) {
            return true;
        }

        const key = environment.googleMapsApiKey?.trim() ?? '';
        if (!key || key.includes('${')) {
            return false;
        }

        const googleRef = (window as any).google;
        if (googleRef?.maps?.places?.AutocompleteService) {
            this.placesAutocompleteService = new googleRef.maps.places.AutocompleteService();
            return true;
        }

        if (!this.googlePlacesLoadPromise) {
            this.googlePlacesLoadPromise = new Promise<boolean>(resolve => {
                const scriptId = 'socialsez-google-places-script';
                const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
                const onReady = () => {
                    const loadedGoogle = (window as any).google;
                    const ctor = loadedGoogle?.maps?.places?.AutocompleteService;
                    if (!ctor) {
                        resolve(false);
                        return;
                    }

                    this.placesAutocompleteService = new ctor();
                    resolve(true);
                };

                if (existing) {
                    existing.addEventListener('load', onReady, { once: true });
                    existing.addEventListener('error', () => resolve(false), { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.id = scriptId;
                script.async = true;
                script.defer = true;
                script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
                script.addEventListener('load', onReady, { once: true });
                script.addEventListener('error', () => resolve(false), { once: true });
                document.head.appendChild(script);
            });
        }

        const loaded = await this.googlePlacesLoadPromise;
        if (!loaded) {
            this.googlePlacesLoadPromise = null;
        }

        return loaded;
    }

    private updateCollaboratorSuggestions(rawValue: string, immediate = false): void {
        const query = this.getCurrentCollaboratorQuery(rawValue);
        if (!query) {
            this.closeCollaboratorSuggestions();
            return;
        }

        if (this.collaboratorSearchDebounceId !== null) {
            window.clearTimeout(this.collaboratorSearchDebounceId);
            this.collaboratorSearchDebounceId = null;
        }

        const token = ++this.collaboratorSearchToken;
        this.collaboratorSearchDebounceId = window.setTimeout(async () => {
            this.collaboratorSearchDebounceId = null;
            try {
                const profiles = await this.session.searchProfilesAsync(query);
                if (token !== this.collaboratorSearchToken) {
                    return;
                }

                const currentHandle = this.session.profile?.handle.toLowerCase() ?? '';
                const alreadyAddedHandles = this.extractCollaboratorHandles(rawValue);
                const loweredQuery = query.toLowerCase();

                const options = profiles
                    .filter(profile => profile.handle.toLowerCase() !== currentHandle)
                    .filter(profile => !alreadyAddedHandles.has(profile.handle.toLowerCase()))
                    .filter(profile => profile.handle.toLowerCase().includes(loweredQuery) || profile.displayName.toLowerCase().includes(loweredQuery))
                    .slice(0, 6);

                this.collaboratorSuggestions = options;
                this.showCollaboratorSuggestions = options.length > 0;
                this.collaboratorsHint = options.length
                    ? 'Select a user to add them as a collaborator.'
                    : 'No matching users found.';
            } catch {
                if (token !== this.collaboratorSearchToken) {
                    return;
                }

                this.collaboratorSuggestions = [];
                this.showCollaboratorSuggestions = false;
                this.collaboratorsHint = 'Could not search users right now.';
            }
        }, immediate ? 0 : 220);
    }

    private getCurrentCollaboratorQuery(value: string): string {
        const query = value.split(',').pop()?.trim() ?? '';
        return query.replace(/^@/, '').trim();
    }

    private extractCollaboratorHandles(value: string): Set<string> {
        const currentToken = this.getCurrentCollaboratorQuery(value).toLowerCase();
        const handles = value
            .split(',')
            .map(segment => segment.trim())
            .filter(segment => !!segment)
            .map(segment => segment.replace(/^@/, '').toLowerCase());

        if (currentToken) {
            return new Set(handles.filter(handle => handle !== currentToken));
        }

        return new Set(handles);
    }

    private replaceCurrentCollaboratorToken(value: string, handle: string): string {
        const segments = value.split(',').map(segment => segment.trim()).filter(segment => !!segment);
        if (!segments.length) {
            return `${handle}, `;
        }

        segments[segments.length - 1] = handle;
        return `${segments.join(', ')}, `;
    }

    private closeLocationSuggestions(): void {
        this.locationSearchToken += 1;
        this.loadingLocationSuggestions = false;
        this.locationSuggestions = [];
        this.showLocationSuggestions = false;
        if (this.locationSearchDebounceId !== null) {
            window.clearTimeout(this.locationSearchDebounceId);
            this.locationSearchDebounceId = null;
        }
    }

    private closeCollaboratorSuggestions(): void {
        this.collaboratorSearchToken += 1;
        this.collaboratorSuggestions = [];
        this.showCollaboratorSuggestions = false;
        if (this.collaboratorSearchDebounceId !== null) {
            window.clearTimeout(this.collaboratorSearchDebounceId);
            this.collaboratorSearchDebounceId = null;
        }
    }

    private beginTrimDragging(part: 'start' | 'end' | 'range', clientX: number, track: HTMLElement): void {
        this.draggingTrimPart = part;
        this.dragOriginClientX = clientX;
        this.dragOriginStartSeconds = this.reelTrimStartSeconds;
        this.dragOriginEndSeconds = this.reelTrimEndSeconds;
        this.dragTrackWidth = Math.max(1, track.getBoundingClientRect().width);
        this.attachTrimDragListeners();
    }

    private handleTrimPointerMove(event: PointerEvent): void {
        if (!this.draggingTrimPart || this.reelVideoDurationSeconds <= 1) {
            return;
        }

        const deltaPx = event.clientX - this.dragOriginClientX;
        const deltaSeconds = (deltaPx / this.dragTrackWidth) * this.reelVideoDurationSeconds;
        const roundedDelta = Math.round(deltaSeconds);

        if (this.draggingTrimPart === 'start') {
            const minStart = Math.max(0, this.reelTrimEndSeconds - ReelComposerModalComponent.MaxTrimDurationSeconds);
            const nextStart = Math.max(minStart, Math.min(this.dragOriginStartSeconds + roundedDelta, this.reelTrimEndSeconds - 1));
            this.reelTrimStartSeconds = nextStart;
            this.syncPreviewToTrimRange();
            return;
        }

        if (this.draggingTrimPart === 'end') {
            const maxEnd = Math.min(this.reelVideoDurationSeconds, this.reelTrimStartSeconds + ReelComposerModalComponent.MaxTrimDurationSeconds);
            const nextEnd = Math.max(this.reelTrimStartSeconds + 1, Math.min(this.dragOriginEndSeconds + roundedDelta, maxEnd));
            this.reelTrimEndSeconds = nextEnd;
            this.syncPreviewToTrimRange();
            return;
        }

        const span = Math.max(1, Math.min(ReelComposerModalComponent.MaxTrimDurationSeconds, this.dragOriginEndSeconds - this.dragOriginStartSeconds));
        const maxStart = Math.max(0, this.reelVideoDurationSeconds - span);
        const nextStart = Math.max(0, Math.min(this.dragOriginStartSeconds + roundedDelta, maxStart));
        this.reelTrimStartSeconds = nextStart;
        this.reelTrimEndSeconds = Math.min(this.reelVideoDurationSeconds, nextStart + span);
        this.syncPreviewToTrimRange();
    }

    private stopTrimDragging(): void {
        this.draggingTrimPart = null;
        this.detachTrimDragListeners();
    }

    private attachTrimDragListeners(): void {
        window.addEventListener('pointermove', this.onGlobalPointerMove);
        window.addEventListener('pointerup', this.onGlobalPointerUp);
        window.addEventListener('pointercancel', this.onGlobalPointerUp);
    }

    private detachTrimDragListeners(): void {
        window.removeEventListener('pointermove', this.onGlobalPointerMove);
        window.removeEventListener('pointerup', this.onGlobalPointerUp);
        window.removeEventListener('pointercancel', this.onGlobalPointerUp);
    }

    private handleFramePointerMove(event: PointerEvent): void {
        if (!this.draggingFrame) {
            return;
        }

        const deltaX = event.clientX - this.frameDragOriginClientX;
        const deltaY = event.clientY - this.frameDragOriginClientY;
        const offsetDeltaX = (deltaX / this.frameDragViewportWidth) * 100;
        const offsetDeltaY = (deltaY / this.frameDragViewportHeight) * 100;
        this.reelFrameOffsetX = this.clampFrameOffset(this.frameDragOriginOffsetX + offsetDeltaX);
        this.reelFrameOffsetY = this.clampFrameOffset(this.frameDragOriginOffsetY + offsetDeltaY);
    }

    private stopFrameDragging(): void {
        this.draggingFrame = false;
        this.detachFrameDragListeners();
        void this.refreshCoverOptionsForCurrentFrame();
    }

    private attachFrameDragListeners(): void {
        window.addEventListener('pointermove', this.onFramePointerMove);
        window.addEventListener('pointerup', this.onFramePointerUp);
        window.addEventListener('pointercancel', this.onFramePointerUp);
    }

    private detachFrameDragListeners(): void {
        window.removeEventListener('pointermove', this.onFramePointerMove);
        window.removeEventListener('pointerup', this.onFramePointerUp);
        window.removeEventListener('pointercancel', this.onFramePointerUp);
    }

    private clampFrameOffset(value: number): number {
        const maxOffset = ReelComposerModalComponent.FrameOffsetLimit;
        return Math.max(-maxOffset, Math.min(value, maxOffset));
    }

    private async refreshCoverOptionsForCurrentFrame(): Promise<void> {
        if (!this.reelVideoFile || this.reelVideoDurationSeconds <= 0) {
            return;
        }

        const token = ++this.frameCoverRefreshToken;
        this.generatingReelCovers = true;

        try {
            await this.generateReelCoverOptions(this.reelVideoFile, this.reelVideoDurationSeconds);
        } catch {
            this.reelComposerError = 'Could not refresh thumbnails for this framing.';
        } finally {
            if (token === this.frameCoverRefreshToken) {
                this.generatingReelCovers = false;
            }
        }
    }

    private async normalizeCustomThumbnailFile(file: File): Promise<File> {
        const image = await this.loadImageFromFile(file);
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) {
            throw new Error('Invalid image dimensions.');
        }

        const crop = this.getReelAspectCrop(sourceWidth, sourceHeight);
        const canvas = document.createElement('canvas');
        canvas.width = crop.width;
        canvas.height = crop.height;

        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Could not initialize thumbnail canvas.');
        }

        context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const blob = await this.canvasToBlob(canvas, 'image/jpeg', 0.9);
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-9x16.jpg`, { type: 'image/jpeg' });
    }

    private getReelAspectCrop(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const targetAspect = ReelComposerModalComponent.ReelOutputAspect;
        const sourceAspect = width / height;

        if (sourceAspect > targetAspect) {
            const cropWidth = Math.max(1, Math.round(height * targetAspect));
            const x = Math.max(0, Math.floor((width - cropWidth) / 2));
            return { x, y: 0, width: cropWidth, height };
        }

        const cropHeight = Math.max(1, Math.round(width / targetAspect));
        const y = Math.max(0, Math.floor((height - cropHeight) / 2));
        return { x: 0, y, width, height: cropHeight };
    }

    private getFrameCropForSource(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const maxAspectCrop = this.getReelAspectCrop(width, height);
        const frameScale = Math.max(0.4, Math.min(1, ReelComposerModalComponent.CropFrameHeightPercent / 100));
        const cropWidth = Math.max(1, Math.round(maxAspectCrop.width * frameScale));
        const cropHeight = Math.max(1, Math.round(maxAspectCrop.height * frameScale));

        const availableShiftX = Math.max(0, (width - cropWidth) / 2);
        const availableShiftY = Math.max(0, (height - cropHeight) / 2);
        const normalizedX = this.reelFrameOffsetX / ReelComposerModalComponent.FrameOffsetLimit;
        const normalizedY = this.reelFrameOffsetY / ReelComposerModalComponent.FrameOffsetLimit;

        const centerX = (width / 2) + (normalizedX * availableShiftX);
        const centerY = (height / 2) + (normalizedY * availableShiftY);
        const shiftedX = Math.max(0, Math.min(width - cropWidth, Math.round(centerX - (cropWidth / 2))));
        const shiftedY = Math.max(0, Math.min(height - cropHeight, Math.round(centerY - (cropHeight / 2))));

        return {
            x: shiftedX,
            y: shiftedY,
            width: cropWidth,
            height: cropHeight
        };
    }

    private loadImageFromFile(file: File): Promise<HTMLImageElement> {
        return new Promise<HTMLImageElement>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();

            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };

            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Could not load image.'));
            };

            image.src = url;
        });
    }

    private canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(new Error('Could not create image blob.'));
                    return;
                }

                resolve(blob);
            }, type, quality);
        });
    }

    private runInZone(action: () => void): void {
        if (NgZone.isInAngularZone()) {
            action();
            return;
        }

        this.ngZone.run(action);
    }

    private syncPreviewToTrimRange(forceSeekToStart = false): void {
        const preview = this.reelPreviewVideoRef?.nativeElement;
        if (!preview || this.reelVideoDurationSeconds <= 0) {
            return;
        }

        const trimStart = Math.max(0, this.reelTrimStartSeconds);
        const trimEnd = Math.max(trimStart + 1, this.reelTrimEndSeconds);
        const outOfRange = preview.currentTime < trimStart || preview.currentTime >= trimEnd;

        if (forceSeekToStart || outOfRange) {
            preview.currentTime = trimStart;
        }
    }
}
