import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CommunityDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { actionError, toUserErrorMessage } from '../../core/user-error.utils';

@Component({
    selector: 'app-communities-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './communities-page.component.html',
    styleUrl: './communities-page.component.scss'
})
export class CommunitiesPageComponent {
    activeTab: 'mine' | 'discover' = 'mine';
    myCommunities: CommunityDto[] = [];
    discoverCommunities: CommunityDto[] = [];

    query = '';
    createName = '';
    createDescription = '';
    createIsPrivate = false;
    createImageFile: File | null = null;
    createImagePreviewUrl: string | null = null;

    loading = false;
    creating = false;
    createModalOpen = false;
    busyCommunityId: string | null = null;
    status = '';
    statusTone: 'neutral' | 'success' | 'error' = 'neutral';

    constructor(private readonly session: SessionService) {
        void this.loadAsync();
    }

    async loadAsync(): Promise<void> {
        this.loading = true;
        this.resetStatus();

        try {
            const [mine, discover] = await Promise.all([
                this.session.loadMyCommunitiesAsync(),
                this.session.discoverCommunitiesAsync(this.query)
            ]);

            this.myCommunities = mine;
            this.discoverCommunities = discover;
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('load communities'));
            this.statusTone = 'error';
        } finally {
            this.loading = false;
        }
    }

    async searchDiscoverAsync(): Promise<void> {
        this.loading = true;
        this.resetStatus();

        try {
            this.discoverCommunities = await this.session.discoverCommunitiesAsync(this.query);
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('search communities'));
            this.statusTone = 'error';
        } finally {
            this.loading = false;
        }
    }

    async createCommunityAsync(): Promise<void> {
        const name = this.createName.trim();
        if (!name || this.creating) {
            return;
        }

        this.creating = true;
        this.resetStatus();

        try {
            let imageUrl: string | null = null;
            if (this.createImageFile) {
                imageUrl = await this.session.uploadImageAsync(this.createImageFile);
            }

            const created = await this.session.createCommunityAsync(
                name,
                this.createDescription.trim() || null,
                imageUrl,
                this.createIsPrivate
            );

            this.myCommunities = [created, ...this.myCommunities.filter(item => item.id !== created.id)];

            if (!created.isPrivate) {
                this.discoverCommunities = [created, ...this.discoverCommunities.filter(item => item.id !== created.id)];
            }

            this.createName = '';
            this.createDescription = '';
            this.createIsPrivate = false;
            this.createImageFile = null;
            this.createImagePreviewUrl = null;
            this.createModalOpen = false;
            this.status = 'Community created.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('create community'));
            this.statusTone = 'error';
        } finally {
            this.creating = false;
        }
    }

    onCreateImageSelected(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0] ?? null;
        this.createImageFile = file;
        this.createImagePreviewUrl = file ? URL.createObjectURL(file) : null;
    }

    openCreateModal(): void {
        this.createModalOpen = true;
        this.resetStatus();
    }

    closeCreateModal(): void {
        if (this.creating) {
            return;
        }

        this.createModalOpen = false;
    }

    async joinCommunityAsync(community: CommunityDto): Promise<void> {
        if (this.busyCommunityId) {
            return;
        }

        this.busyCommunityId = community.id;
        this.resetStatus();

        try {
            const joined = await this.session.joinCommunityAsync(community.id);
            this.myCommunities = [joined, ...this.myCommunities.filter(item => item.id !== joined.id)];
            this.discoverCommunities = this.discoverCommunities.map(item => item.id === joined.id ? joined : item);
            this.status = 'Joined community.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('join community'));
            this.statusTone = 'error';
        } finally {
            this.busyCommunityId = null;
        }
    }

    async leaveCommunityAsync(community: CommunityDto): Promise<void> {
        if (this.busyCommunityId) {
            return;
        }

        this.busyCommunityId = community.id;
        this.resetStatus();

        try {
            await this.session.leaveCommunityAsync(community.id);
            this.myCommunities = this.myCommunities.filter(item => item.id !== community.id);
            this.discoverCommunities = this.discoverCommunities.map(item => item.id === community.id ? { ...item, joinedByMe: false, myRole: undefined } : item);
            this.status = 'Left community.';
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, actionError('leave community'));
            this.statusTone = 'error';
        } finally {
            this.busyCommunityId = null;
        }
    }

    trackByCommunityId(_index: number, community: CommunityDto): string {
        return community.id;
    }

    private resetStatus(): void {
        this.status = '';
        this.statusTone = 'neutral';
    }
}
