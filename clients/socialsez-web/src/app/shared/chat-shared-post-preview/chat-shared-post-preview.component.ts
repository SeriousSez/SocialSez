import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { SharedPostPreview } from '../../core/shared-post.utils';

interface RichTextPart {
    text: string;
    hashtag?: string;
    mentionHandle?: string;
}

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

    get previewLines(): RichTextPart[][] {
        return this.previewText
            .split(/\r?\n/)
            .map(line => this.parseRichLineParts(line));
    }

    openHashtag(tag: string, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/hashtags', tag]);
    }

    openUserProfile(handle: string, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/users', handle]);
    }

    openPost(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/post', this.shared.postId]);
    }

    private parseRichLineParts(line: string): RichTextPart[] {
        const tokenRegex = /#[\p{L}\p{N}_]+|\B@[\p{L}\p{N}_]+/gu;
        const parts: RichTextPart[] = [];
        let cursor = 0;

        for (const match of line.matchAll(tokenRegex)) {
            const rawToken = match[0] ?? '';
            const start = match.index ?? -1;
            if (start < 0) {
                continue;
            }

            if (start > cursor) {
                parts.push({ text: line.slice(cursor, start) });
            }

            if (rawToken.startsWith('#')) {
                parts.push({ text: rawToken, hashtag: rawToken.slice(1) });
            } else {
                parts.push({ text: rawToken, mentionHandle: rawToken.slice(1) });
            }

            cursor = start + rawToken.length;
        }

        if (cursor < line.length) {
            parts.push({ text: line.slice(cursor) });
        }

        return parts.length ? parts : [{ text: line }];
    }
}
