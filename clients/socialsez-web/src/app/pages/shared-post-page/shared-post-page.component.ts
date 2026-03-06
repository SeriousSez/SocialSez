import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NgZone } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PostDto } from '../../core/api.types';
import { SocialSezApiService } from '../../core/socialsez-api.service';
import { SessionService } from '../../core/session.service';

interface SharedContentPart {
    text: string;
    hashtag?: string;
}

@Component({
    selector: 'app-shared-post-page',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './shared-post-page.component.html',
    styleUrl: './shared-post-page.component.scss'
})
export class SharedPostPageComponent {
    loading = true;
    notFound = false;
    error = '';
    copiedLink = false;
    post: PostDto | null = null;
    hashtagClickCount = 0;
    lastClickedHashtag = '';
    private copiedLinkTimeoutId: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly route: ActivatedRoute, private readonly api: SocialSezApiService, public readonly session: SessionService, private readonly ngZone: NgZone) {
        this.route.paramMap.subscribe(params => {
            const postId = (params.get('id') ?? '').trim();
            void this.loadAsync(postId);
        });
    }

    isVideoMedia(mediaUrl: string): boolean {
        return /\.(mp4|webm|mov|m4v|ogv)(?:\?.*)?$/i.test(mediaUrl);
    }

    async copyLinkAsync(): Promise<void> {
        const postId = this.post?.id;
        if (!postId) {
            return;
        }

        const link = `${window.location.origin}/post/${postId}`;
        await navigator.clipboard.writeText(link);
        this.ngZone.run(() => {
            this.copiedLink = true;
            if (this.copiedLinkTimeoutId) {
                clearTimeout(this.copiedLinkTimeoutId);
            }

            this.copiedLinkTimeoutId = setTimeout(() => {
                this.ngZone.run(() => {
                    this.copiedLink = false;
                    this.copiedLinkTimeoutId = null;
                });
            }, 1800);
        });
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

    private async loadAsync(postId: string): Promise<void> {
        this.loading = true;
        this.notFound = false;
        this.error = '';
        this.post = null;

        if (!postId) {
            this.notFound = true;
            this.loading = false;
            return;
        }

        try {
            this.post = await firstValueFrom(this.api.getPublicPost(postId));
        } catch (error: any) {
            if (error?.status === 404) {
                this.notFound = true;
            } else {
                this.error = 'Could not load this shared post.';
            }
        } finally {
            this.loading = false;
        }
    }
}
