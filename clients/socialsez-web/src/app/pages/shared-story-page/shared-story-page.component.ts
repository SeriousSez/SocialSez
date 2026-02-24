import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { StoryDto } from '../../core/api.types';
import { SocialSezApiService } from '../../core/socialsez-api.service';

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
