import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { SharedPostPreview } from '../../core/shared-post.utils';

@Component({
    selector: 'app-chat-shared-post-preview',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './chat-shared-post-preview.component.html',
    styleUrl: './chat-shared-post-preview.component.scss'
})
export class ChatSharedPostPreviewComponent {
    private readonly sharedPreviewMaxChars = 320;

    @Input({ required: true }) shared!: SharedPostPreview;

    constructor(private readonly router: Router) { }

    get previewText(): string {
        const source = (this.shared?.content ?? '').trim();
        if (!source) {
            return '';
        }

        if (source.length <= this.sharedPreviewMaxChars) {
            return source;
        }

        return `${source.slice(0, this.sharedPreviewMaxChars).trimEnd()}...`;
    }

    openPost(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/post', this.shared.postId]);
    }
}
