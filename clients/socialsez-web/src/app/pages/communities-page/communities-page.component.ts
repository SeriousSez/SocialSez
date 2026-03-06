import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommunityDto, CommunityRuleDto } from '../../core/api.types';
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
    createRulesText = '';
    createIsPrivate = false;
    createImageFile: File | null = null;
    createImagePreviewUrl: string | null = null;

    loading = false;
    readonly skeletonRows = [0, 1, 2, 3];
    creating = false;
    createModalOpen = false;
    busyCommunityId: string | null = null;
    status = '';
    statusTone: 'neutral' | 'success' | 'error' = 'neutral';

    get isAuthenticated(): boolean {
        return this.session.isAuthenticated();
    }

    constructor(public readonly session: SessionService, private readonly router: Router) {
        if (!this.session.isAuthenticated()) {
            this.activeTab = 'discover';
        }

        void this.loadAsync();
    }

    async loadAsync(): Promise<void> {
        this.loading = true;
        this.resetStatus();

        try {
            this.discoverCommunities = await this.session.discoverCommunitiesAsync(this.query);

            if (this.session.isAuthenticated()) {
                this.myCommunities = await this.session.loadMyCommunitiesAsync();
            } else {
                this.myCommunities = [];
            }
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
        if (this.requireAuthForAction('create a community')) {
            return;
        }

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
                this.parseRulesText(this.createRulesText),
                imageUrl,
                this.createIsPrivate
            );

            this.myCommunities = [created, ...this.myCommunities.filter(item => item.id !== created.id)];

            if (!created.isPrivate) {
                this.discoverCommunities = [created, ...this.discoverCommunities.filter(item => item.id !== created.id)];
            }

            this.createName = '';
            this.createDescription = '';
            this.createRulesText = '';
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
        if (this.requireAuthForAction('join communities')) {
            return;
        }

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
        if (this.requireAuthForAction('leave communities')) {
            return;
        }

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

    private parseRulesText(rulesText: string): CommunityRuleDto[] {
        return (rulesText ?? '')
            .split('\n')
            .map(rule => rule.trim())
            .filter(rule => !!rule)
            .map(rule => ({ text: rule }));
    }

    private requireAuthForAction(action: string): boolean {
        if (this.session.isAuthenticated()) {
            return false;
        }

        this.session.message = `Please sign in or create an account to ${action}.`;
        void this.router.navigate(['/auth']);
        return true;
    }
}
