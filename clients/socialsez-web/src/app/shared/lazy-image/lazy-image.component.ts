import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { SkeletonComponent } from '../skeleton/skeleton.component';

@Component({
    selector: 'app-lazy-image',
    standalone: true,
    imports: [CommonModule, SkeletonComponent],
    template: `
        <div class="lazy-image-shell">
            <app-skeleton
                *ngIf="!loaded && !failed"
                width="100%"
                [height]="skeletonHeight"
                [radius]="skeletonRadius">
            </app-skeleton>

            <img
                *ngIf="currentSrc"
                #imageEl
                [class]="imgClass"
                [src]="currentSrc"
                [alt]="alt"
                [attr.loading]="loading"
                [attr.decoding]="decoding"
                [style.display]="'block'"
                [style.opacity]="loaded ? '1' : '0'"
                [style.pointer-events]="loaded ? 'auto' : 'none'"
                [style.position]="loaded ? 'static' : 'absolute'"
                [style.inset]="loaded ? null : '0'"
                [style.width]="loaded ? null : '100%'"
                [style.height]="loaded ? null : '100%'"
                [style.transition]="'opacity 180ms ease'"
                (load)="onLoaded()"
                (error)="onLoadError()" />

            <div class="lazy-image-fallback" *ngIf="failed">Image unavailable</div>
        </div>
    `,
    styles: [
        `
            .lazy-image-shell {
                display: block;
                position: relative;
            }

            .lazy-image-fallback {
                border: 1px dashed #cbd5e1;
                border-radius: 10px;
                color: #64748b;
                font-size: 12px;
                text-align: center;
                padding: 12px;
                background: #f8fafc;
            }

            :host-context(.theme-dark) .lazy-image-fallback {
                border-color: #334155;
                color: #94a3b8;
                background: #0f172a;
            }
        `
    ]
})
export class LazyImageComponent implements OnChanges, AfterViewChecked {
    @Input() src: string | null = null;
    @Input() alt = 'Image';
    @Input() imgClass = '';
    @Input() loading: 'lazy' | 'eager' = 'lazy';
    @Input() decoding: 'async' | 'auto' | 'sync' = 'async';
    @Input() skeletonHeight = '180px';
    @Input() skeletonRadius = '10px';
    @Input() fallbackSrc: string | null = null;

    loaded = false;
    failed = false;
    currentSrc: string | null = null;
    @ViewChild('imageEl') imageEl?: ElementRef<HTMLImageElement>;
    private triedFallback = false;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['src']) {
            this.resetState();
        }
    }

    onLoaded(): void {
        this.loaded = true;
        this.failed = false;
    }

    onLoadError(): void {
        if (!this.triedFallback && this.fallbackSrc) {
            this.triedFallback = true;
            this.currentSrc = this.fallbackSrc;
            return;
        }

        this.loaded = false;
        this.failed = true;
    }

    ngAfterViewChecked(): void {
        this.syncLoadedFromDom();
    }

    private resetState(): void {
        const normalizedSrc = this.src?.trim() ?? '';
        this.currentSrc = normalizedSrc.length > 0 ? normalizedSrc : null;
        this.loaded = false;
        this.failed = !this.currentSrc;
        this.triedFallback = false;
    }

    private syncLoadedFromDom(): void {
        if (this.loaded || this.failed) {
            return;
        }

        const image = this.imageEl?.nativeElement;
        if (!image) {
            return;
        }

        if (image.complete && image.naturalWidth > 0) {
            this.onLoaded();
        }
    }
}
