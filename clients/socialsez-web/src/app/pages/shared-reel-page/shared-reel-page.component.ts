import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ReelDto } from '../../core/api.types';
import { SocialSezApiService } from '../../core/socialsez-api.service';

@Component({
    selector: 'app-shared-reel-page',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './shared-reel-page.component.html',
    styleUrl: './shared-reel-page.component.scss'
})
export class SharedReelPageComponent {
    loading = true;
    notFound = false;
    error = '';
    reel: ReelDto | null = null;

    constructor(private readonly route: ActivatedRoute, private readonly api: SocialSezApiService) {
        this.route.paramMap.subscribe(params => {
            const reelId = (params.get('id') ?? '').trim();
            void this.loadAsync(reelId);
        });
    }

    async copyLinkAsync(): Promise<void> {
        const reelId = this.reel?.id;
        if (!reelId) {
            return;
        }

        const link = `${window.location.origin}/shared/reel/${reelId}`;
        await navigator.clipboard.writeText(link);
    }

    private async loadAsync(reelId: string): Promise<void> {
        this.loading = true;
        this.notFound = false;
        this.error = '';
        this.reel = null;

        if (!reelId) {
            this.notFound = true;
            this.loading = false;
            return;
        }

        try {
            this.reel = await firstValueFrom(this.api.getPublicReel(reelId));
        } catch (error: any) {
            if (error?.status === 404) {
                this.notFound = true;
            } else {
                this.error = 'Could not load this shared reel.';
            }
        } finally {
            this.loading = false;
        }
    }
}
