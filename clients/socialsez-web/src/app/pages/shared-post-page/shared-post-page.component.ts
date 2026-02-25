import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PostDto } from '../../core/api.types';
import { SocialSezApiService } from '../../core/socialsez-api.service';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-shared-post-page',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './shared-post-page.component.html',
    styleUrl: './shared-post-page.component.scss'
})
export class SharedPostPageComponent {
    loading = true;
    notFound = false;
    error = '';
    post: PostDto | null = null;

    constructor(private readonly route: ActivatedRoute, private readonly api: SocialSezApiService, public readonly session: SessionService) {
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

        const link = `${window.location.origin}/shared/post/${postId}`;
        await navigator.clipboard.writeText(link);
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
