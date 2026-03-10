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
    private readonly sharedPreviewMaxLines = 7;

    @Input({ required: true }) shared!: SharedPostPreview;

    constructor(private readonly router: Router) { }

    richTextLines(content: string): RichTextPart[][] {
        return content
            .split(/\r?\n/)
            .map(line => this.parseRichTextLine(line));
    }

    sharedPreviewContent(content: string): string {
        const source = (content ?? '').trim();
        if (!source) {
            return '';
        }

        const lines = source.split(/\r?\n/);
        const clippedLines = lines.slice(0, this.sharedPreviewMaxLines);
        let clipped = clippedLines.join('\n');

        if (clipped.length > this.sharedPreviewMaxChars) {
            clipped = clipped.slice(0, this.sharedPreviewMaxChars).trimEnd();
        }

        const truncated = clipped.length < source.length || lines.length > this.sharedPreviewMaxLines;
        if (truncated) {
            return `${clipped}...`;
        }

        return clipped;
    }

    onCardClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('a, button, input, textarea, select')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/post', this.shared.postId]);
    }

    onCardKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/post', this.shared.postId]);
    }

    openHashtag(tag: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/hashtags', tag]);
    }

    openUserProfile(handle: string, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        void this.router.navigate(['/users', handle]);
    }

    private parseRichTextLine(line: string): RichTextPart[] {
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

        if (!parts.length) {
            parts.push({ text: '' });
        }

        return parts;
    }
}
