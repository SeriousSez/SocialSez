import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-skeleton',
    standalone: true,
    template: `
        <span
            class="skeleton-block"
            [style.width]="width"
            [style.height]="height"
            [style.border-radius]="radius"
            aria-hidden="true">
        </span>
    `,
    styles: [
        `
            :host {
                display: block;
                --skeleton-base: #e2e8f0;
                --skeleton-highlight: #f1f5f9;
            }

            :host-context(.theme-dark) {
                --skeleton-base: #0f172a;
                --skeleton-highlight: #1e293b;
            }

            .skeleton-block {
                display: block;
                background: linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-highlight) 50%, var(--skeleton-base) 75%);
                background-size: 240% 100%;
                animation: skeleton-shimmer 1.25s ease-in-out infinite;
            }

            @keyframes skeleton-shimmer {
                0% {
                    background-position: 100% 0;
                }

                100% {
                    background-position: -100% 0;
                }
            }
        `
    ]
})
export class SkeletonComponent {
    @Input() width = '100%';
    @Input() height = '14px';
    @Input() radius = '8px';
}
