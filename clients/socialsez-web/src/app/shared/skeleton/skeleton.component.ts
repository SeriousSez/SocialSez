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
            }

            .skeleton-block {
                display: block;
                background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
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
