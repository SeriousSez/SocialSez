import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { StoryDto, StoryGroupDto } from '../../core/api.types';

@Component({
    selector: 'app-feed-story-viewer',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './feed-story-viewer.component.html',
    styleUrl: './feed-story-viewer.component.scss'
})
export class FeedStoryViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
    constructor(private readonly router: Router) { }

    @Input() activeStory: StoryDto | null = null;
    @Input() activeStoryGroup: StoryGroupDto | null = null;
    @Input() activeStoryIndex = 0;
    @Input() storyCount = 0;
    @Input() hasPreviousStory = false;
    @Input() hasNextStory = false;
    @Input() liked = false;
    @Input() sendingReply = false;
    @Input() sharingStory = false;
    @Input() canDelete = false;
    @Input() deletingStory = false;
    @Input() errorMessage = '';

    @ViewChild('storyVideoEl') private readonly storyVideoRef?: ElementRef<HTMLVideoElement>;

    @Output() closed = new EventEmitter<void>();
    @Output() previous = new EventEmitter<void>();
    @Output() next = new EventEmitter<void>();
    @Output() replySubmitted = new EventEmitter<{ story: StoryDto; message: string }>();
    @Output() likeToggled = new EventEmitter<StoryDto>();
    @Output() shareRequested = new EventEmitter<StoryDto>();
    @Output() deleteRequested = new EventEmitter<StoryDto>();

    replyDraft = '';
    paused = false;
    storyMuted = false;
    currentStoryProgress = 0;
    isClosing = false;

    private imageProgressFrameId = 0;
    private videoProgressFrameId = 0;
    private imageProgressStartTime = 0;
    private imageProgressElapsedBeforePause = 0;
    private readonly imageStoryDurationMs = 8000;
    private closeTimeoutId: number | null = null;

    ngAfterViewInit(): void {
        this.resetPlaybackState();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['activeStory']) {
            this.replyDraft = '';
            this.isClosing = false;
            this.clearCloseTimeout();
            this.resetPlaybackState();
        }
    }

    ngOnDestroy(): void {
        this.stopImageProgressLoop();
        this.stopVideoProgressLoop();
        this.clearCloseTimeout();
    }

    close(): void {
        if (this.isClosing) {
            return;
        }

        this.isClosing = true;
        this.clearCloseTimeout();
        this.closeTimeoutId = window.setTimeout(() => {
            this.closeTimeoutId = null;
            this.closed.emit();
        }, 180);
    }

    showPrevious(): void {
        this.previous.emit();
    }

    showNext(): void {
        this.next.emit();
    }

    openAuthorProfile(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const handle = this.activeStoryGroup?.authorHandle?.trim();
        if (!handle) {
            return;
        }

        this.isClosing = false;
        void this.router.navigate(['/users', handle]);
        this.closed.emit();
    }

    togglePause(): void {
        const story = this.activeStory;
        if (!story) {
            return;
        }

        if (this.isVideoStory(story.mediaUrl)) {
            const video = this.storyVideoRef?.nativeElement;
            if (!video) {
                return;
            }

            if (video.paused) {
                this.paused = false;
                void video.play().catch(() => {
                    this.paused = true;
                });
                return;
            }

            video.pause();
            this.paused = true;
            return;
        }

        if (this.paused) {
            this.resumeImageProgress();
            return;
        }

        this.pauseImageProgress();
    }

    toggleStoryMute(): void {
        const story = this.activeStory;
        if (!story || !this.isVideoStory(story.mediaUrl)) {
            return;
        }

        this.storyMuted = !this.storyMuted;

        const video = this.storyVideoRef?.nativeElement;
        if (!video) {
            return;
        }

        video.muted = this.storyMuted;
        if (video.paused) {
            void video.play().catch(() => {
                this.paused = true;
            });
        }
    }

    onVideoLoadedMetadata(video: HTMLVideoElement): void {
        if (!this.activeStory || !this.isVideoStory(this.activeStory.mediaUrl)) {
            return;
        }

        this.currentStoryProgress = 0;
        this.paused = false;
        video.muted = this.storyMuted;
        video.currentTime = 0;
        void this.playVideoWithAutoplayFallback(video);
    }

    onVideoPlay(): void {
        this.paused = false;
        this.startVideoProgressLoop();
    }

    onVideoPause(): void {
        this.paused = true;
        this.stopVideoProgressLoop();
    }

    onVideoTimeUpdate(video: HTMLVideoElement): void {
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
            this.currentStoryProgress = 0;
            return;
        }

        this.currentStoryProgress = Math.max(0, Math.min(1, video.currentTime / video.duration));
    }

    onVideoEnded(): void {
        this.stopVideoProgressLoop();
        this.currentStoryProgress = 1;
        this.showNext();
    }

    onReplySubmit(): void {
        const story = this.activeStory;
        const message = this.replyDraft.trim();
        if (!story || !message || this.sendingReply) {
            return;
        }

        this.replySubmitted.emit({ story, message });
        this.replyDraft = '';
    }

    onLikeClick(): void {
        if (!this.activeStory) {
            return;
        }

        this.likeToggled.emit(this.activeStory);
    }

    onShareClick(): void {
        if (!this.activeStory || this.sharingStory) {
            return;
        }

        this.shareRequested.emit(this.activeStory);
    }

    onDeleteClick(): void {
        if (!this.activeStory || !this.canDelete || this.deletingStory) {
            return;
        }

        this.deleteRequested.emit(this.activeStory);
    }

    get storySegments(): number[] {
        const total = Math.max(1, this.storyCount);
        return Array.from({ length: total }, (_, index) => index);
    }

    get pauseLabel(): string {
        return this.paused ? 'Resume story' : 'Pause story';
    }

    get pauseIcon(): string {
        return this.paused ? '▶' : '❚❚';
    }

    get muteLabel(): string {
        return this.storyMuted ? 'Unmute story' : 'Mute story';
    }

    get muteIcon(): string {
        return this.storyMuted ? '🔇' : '🔊';
    }

    getStorySegmentProgress(segmentIndex: number): number {
        if (segmentIndex < this.activeStoryIndex) {
            return 100;
        }

        if (segmentIndex > this.activeStoryIndex) {
            return 0;
        }

        return Math.round(this.currentStoryProgress * 100);
    }

    isVideoStory(mediaUrl: string): boolean {
        return /\.(mp4|webm|mov|m4v|ogv)(?:\?.*)?$/i.test(mediaUrl);
    }

    formatStoryAge(createdAtUtc: string): string {
        const createdAt = new Date(createdAtUtc).getTime();
        if (!Number.isFinite(createdAt)) {
            return '';
        }

        const elapsedSeconds = Math.max(1, Math.floor((Date.now() - createdAt) / 1000));
        if (elapsedSeconds < 60) {
            return `${elapsedSeconds}s`;
        }

        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        if (elapsedMinutes < 60) {
            return `${elapsedMinutes}m`;
        }

        const elapsedHours = Math.floor(elapsedMinutes / 60);
        if (elapsedHours < 24) {
            return `${elapsedHours}h`;
        }

        const elapsedDays = Math.floor(elapsedHours / 24);
        return `${elapsedDays}d`;
    }

    private resetPlaybackState(): void {
        this.stopImageProgressLoop();
        this.stopVideoProgressLoop();
        this.currentStoryProgress = 0;
        this.paused = false;
        this.imageProgressElapsedBeforePause = 0;

        const story = this.activeStory;
        if (!story) {
            return;
        }

        if (!this.isVideoStory(story.mediaUrl)) {
            this.resumeImageProgress();
            return;
        }

        window.setTimeout(() => {
            const video = this.storyVideoRef?.nativeElement;
            if (!video || this.activeStory?.id !== story.id) {
                return;
            }

            video.currentTime = 0;
            video.muted = this.storyMuted;
            this.paused = false;
            void this.playVideoWithAutoplayFallback(video);
        }, 0);
    }

    private async playVideoWithAutoplayFallback(video: HTMLVideoElement): Promise<void> {
        try {
            await video.play();
            this.paused = false;
            return;
        } catch {
            if (!this.storyMuted) {
                this.storyMuted = true;
                video.muted = true;

                try {
                    await video.play();
                    this.paused = false;
                    return;
                } catch {
                    this.paused = true;
                    return;
                }
            }

            this.paused = true;
        }
    }

    private resumeImageProgress(): void {
        if (!this.activeStory || this.isVideoStory(this.activeStory.mediaUrl)) {
            return;
        }

        this.paused = false;
        this.imageProgressStartTime = performance.now();
        this.startImageProgressLoop();
    }

    private pauseImageProgress(): void {
        this.paused = true;
        this.imageProgressElapsedBeforePause += Math.max(0, performance.now() - this.imageProgressStartTime);
        this.stopImageProgressLoop();
    }

    private startImageProgressLoop(): void {
        this.stopImageProgressLoop();

        const tick = (): void => {
            if (!this.activeStory || this.paused || this.isVideoStory(this.activeStory.mediaUrl)) {
                return;
            }

            const elapsed = this.imageProgressElapsedBeforePause + Math.max(0, performance.now() - this.imageProgressStartTime);
            this.currentStoryProgress = Math.max(0, Math.min(1, elapsed / this.imageStoryDurationMs));

            if (this.currentStoryProgress >= 1) {
                this.currentStoryProgress = 1;
                this.showNext();
                return;
            }

            this.imageProgressFrameId = window.requestAnimationFrame(tick);
        };

        this.imageProgressFrameId = window.requestAnimationFrame(tick);
    }

    private stopImageProgressLoop(): void {
        if (!this.imageProgressFrameId) {
            return;
        }

        window.cancelAnimationFrame(this.imageProgressFrameId);
        this.imageProgressFrameId = 0;
    }

    private startVideoProgressLoop(): void {
        const video = this.storyVideoRef?.nativeElement;
        if (!video) {
            return;
        }

        this.stopVideoProgressLoop();

        const tick = (): void => {
            const currentVideo = this.storyVideoRef?.nativeElement;
            if (!currentVideo || currentVideo.paused || currentVideo.ended) {
                return;
            }

            if (Number.isFinite(currentVideo.duration) && currentVideo.duration > 0) {
                this.currentStoryProgress = Math.max(0, Math.min(1, currentVideo.currentTime / currentVideo.duration));
            }

            this.videoProgressFrameId = window.requestAnimationFrame(tick);
        };

        this.videoProgressFrameId = window.requestAnimationFrame(tick);
    }

    private stopVideoProgressLoop(): void {
        if (!this.videoProgressFrameId) {
            return;
        }

        window.cancelAnimationFrame(this.videoProgressFrameId);
        this.videoProgressFrameId = 0;
    }

    private clearCloseTimeout(): void {
        if (this.closeTimeoutId === null) {
            return;
        }

        window.clearTimeout(this.closeTimeoutId);
        this.closeTimeoutId = null;
    }
}
