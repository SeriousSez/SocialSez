import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { StoryDto } from '../../core/api.types';
import { SocialSezApiService } from '../../core/socialsez-api.service';

interface SharedContentPart {
    text: string;
    hashtag?: string;
}

@Component({
    selector: 'app-shared-story-page',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './shared-story-page.component.html',
    styleUrl: './shared-story-page.component.scss'
})
export class SharedStoryPageComponent {
    loading = true;
    notFound = false;
    error = '';
    story: StoryDto | null = null;
    hashtagClickCount = 0;
    lastClickedHashtag = '';

    constructor(private readonly route: ActivatedRoute, private readonly api: SocialSezApiService) {
        this.route.paramMap.subscribe(params => {
            const storyId = (params.get('id') ?? '').trim();
            void this.loadAsync(storyId);
        });
    }

    isVideoMedia(mediaUrl: string): boolean {
        return /\.(mp4|webm|mov|m4v|ogv)(?:\?.*)?$/i.test(mediaUrl);
    }

    async copyLinkAsync(): Promise<void> {
        const storyId = this.story?.id;
        if (!storyId) {
            return;
        }

        const link = `${window.location.origin}/shared/story/${storyId}`;
        await navigator.clipboard.writeText(link);
    }

    contentLines(content: string): SharedContentPart[][] {
        return (content ?? '')
            .split(/\r?\n/)
            .map(line => this.parseLineParts(line));
    }

    goToHashtag(tag: string, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.hashtagClickCount += 1;
        this.lastClickedHashtag = tag;
        window.setTimeout(() => {
            window.location.assign(`/hashtags/${encodeURIComponent(tag)}`);
        }, 0);
    }

    private parseLineParts(line: string): SharedContentPart[] {
        const tokenRegex = /#[^\s#]+/g;
        const parts: SharedContentPart[] = [];
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

            const rawTag = rawToken.slice(1);
            const normalizedTag = rawTag.replace(/[.,!?;:)\]}]+$/g, '');
            const trailing = rawTag.slice(normalizedTag.length);

            if (normalizedTag.length > 0) {
                parts.push({ text: `#${normalizedTag}`, hashtag: normalizedTag });
                if (trailing.length > 0) {
                    parts.push({ text: trailing });
                }
            } else {
                parts.push({ text: rawToken });
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

    private async loadAsync(storyId: string): Promise<void> {
        this.loading = true;
        this.notFound = false;
        this.error = '';
        this.story = null;

        if (!storyId) {
            this.notFound = true;
            this.loading = false;
            return;
        }

        try {
            this.story = await firstValueFrom(this.api.getPublicStory(storyId));
        } catch (error: any) {
            if (error?.status === 404) {
                this.notFound = true;
            } else {
                this.error = 'Could not load this shared story.';
            }
        } finally {
            this.loading = false;
        }
    }
}
