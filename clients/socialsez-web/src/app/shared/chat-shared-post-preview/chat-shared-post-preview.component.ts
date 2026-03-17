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

    get previewHtml(): string {
        const source = (this.shared?.content ?? '').trim();
        if (!source) {
            return '';
        }

        if (this.isLikelyHtml(source)) {
            return source;
        }

        const truncated = source.length <= this.sharedPreviewMaxChars
            ? source
            : `${source.slice(0, this.sharedPreviewMaxChars).trimEnd()}...`;

        return this.escapeHtml(truncated).replace(/\r?\n/g, '<br>');
    }

    private isLikelyHtml(value: string): boolean {
        return /<[a-z][\s\S]*>/i.test(value);
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    openPost(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/post', this.shared.postId]);
    }
}
