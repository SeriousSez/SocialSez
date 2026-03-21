import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CommunityDto, CommunityRuleDto } from '../../core/api.types';
import { buildDiscoverySuggestions, DISCOVERY_TOPICS, rankByDiscoveryQuery, scoreDiscoveryFields } from '../../core/discovery-search.util';
import { HashtagTextPart, splitHashtagText } from '../../core/hashtag-text.util';
import { SessionService } from '../../core/session.service';
import { toUserErrorMessage } from '../../core/user-error.utils';
import { RichTextEditorComponent } from '../../shared/rich-text-editor/rich-text-editor.component';
import { TranslateContentComponent } from '../../shared/translate-content/translate-content.component';

@Component({
    selector: 'app-communities-page',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, RichTextEditorComponent, TranslateContentComponent],
    templateUrl: './communities-page.component.html',
    styleUrl: './communities-page.component.scss'
})
export class CommunitiesPageComponent implements OnDestroy {
    activeTab: 'mine' | 'discover' = 'mine';
    myCommunities: CommunityDto[] = [];
    discoverCommunities: CommunityDto[] = [];
    discoverSourceCommunities: CommunityDto[] = [];

    query = '';
    suggestions: string[] = [];
    private readonly suggestionSeed = new Set<string>(DISCOVERY_TOPICS.map(topic => topic.canonical));
    private queryDebounceTimerId: number | null = null;
    private readonly translate = inject(TranslateService);
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
            const backendQuery = this.query.trim() || undefined;
            this.applyDiscoverResults(await this.session.discoverCommunitiesAsync(backendQuery, 120));

            if (this.session.isAuthenticated()) {
                this.myCommunities = await this.session.loadMyCommunitiesAsync();
            } else {
                this.myCommunities = [];
            }
        } catch (error) {
            this.status = toUserErrorMessage(error, this.t('communities.errors.load'));
            this.statusTone = 'error';
        } finally {
            this.loading = false;
        }
    }

    async searchDiscoverAsync(): Promise<void> {
        this.loading = true;
        this.resetStatus();

        try {
            const backendQuery = this.query.trim() || undefined;
            this.applyDiscoverResults(await this.session.discoverCommunitiesAsync(backendQuery, 120));
        } catch (error) {
            this.status = toUserErrorMessage(error, this.t('communities.errors.search'));
            this.statusTone = 'error';
        } finally {
            this.loading = false;
        }
    }

    onDiscoverQueryInput(): void {
        if (this.queryDebounceTimerId !== null) {
            window.clearTimeout(this.queryDebounceTimerId);
            this.queryDebounceTimerId = null;
        }

        this.refreshSuggestions();
        this.queryDebounceTimerId = window.setTimeout(() => {
            this.queryDebounceTimerId = null;
            void this.searchDiscoverAsync();
        }, 220);
    }

    async clearDiscoverQueryAsync(): Promise<void> {
        if (!this.query.trim()) {
            return;
        }

        this.query = '';
        this.refreshSuggestions();
        await this.searchDiscoverAsync();
    }

    async applySuggestionAsync(suggestion: string): Promise<void> {
        const next = suggestion.trim();
        if (!next) {
            return;
        }

        this.query = next;
        this.refreshSuggestions();
        await this.searchDiscoverAsync();
    }

    async createCommunityAsync(): Promise<void> {
        if (this.requireAuthForAction('create')) {
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
                this.discoverSourceCommunities = [created, ...this.discoverSourceCommunities.filter(item => item.id !== created.id)];
                this.discoverCommunities = this.filterAndRankDiscover(this.discoverSourceCommunities, this.query);
            }

            this.createName = '';
            this.createDescription = '';
            this.createRulesText = '';
            this.createIsPrivate = false;
            this.createImageFile = null;
            this.createImagePreviewUrl = null;
            this.createModalOpen = false;
            this.status = this.t('communities.status.created');
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, this.t('communities.errors.create'));
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
        if (this.requireAuthForAction('join')) {
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
            this.discoverSourceCommunities = this.discoverSourceCommunities.map(item => item.id === joined.id ? joined : item);
            this.discoverCommunities = this.filterAndRankDiscover(this.discoverSourceCommunities, this.query);
            this.status = this.t('communities.status.joined');
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, this.t('communities.errors.join'));
            this.statusTone = 'error';
        } finally {
            this.busyCommunityId = null;
        }
    }

    async leaveCommunityAsync(community: CommunityDto): Promise<void> {
        if (this.requireAuthForAction('leave')) {
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
            this.discoverSourceCommunities = this.discoverSourceCommunities.map(item => item.id === community.id ? { ...item, joinedByMe: false, myRole: undefined } : item);
            this.discoverCommunities = this.filterAndRankDiscover(this.discoverSourceCommunities, this.query);
            this.status = this.t('communities.status.left');
            this.statusTone = 'success';
        } catch (error) {
            this.status = toUserErrorMessage(error, this.t('communities.errors.leave'));
            this.statusTone = 'error';
        } finally {
            this.busyCommunityId = null;
        }
    }

    canLeaveCommunity(community: CommunityDto): boolean {
        if (!community.joinedByMe) {
            return false;
        }

        const role = (community.myRole ?? '').trim().toLowerCase();
        return role !== 'owner';
    }

    isCommunityOwner(community: CommunityDto): boolean {
        const role = (community.myRole ?? '').trim().toLowerCase();
        return role === 'owner';
    }

    trackByCommunityId(_index: number, community: CommunityDto): string {
        return community.id;
    }

    openCommunityFromCard(community: CommunityDto, event: Event): void {
        if (this.shouldIgnoreCardNavigation(event)) {
            return;
        }

        void this.router.navigate(['/c', community.slug]);
    }

    onCommunityCardKeydown(event: KeyboardEvent, community: CommunityDto): void {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        void this.router.navigate(['/c', community.slug]);
    }

    ngOnDestroy(): void {
        if (this.queryDebounceTimerId !== null) {
            window.clearTimeout(this.queryDebounceTimerId);
            this.queryDebounceTimerId = null;
        }
    }

    splitHashtagText(content: string | null | undefined): HashtagTextPart[][] {
        return splitHashtagText(content);
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

    private requireAuthForAction(action: 'create' | 'join' | 'leave'): boolean {
        if (this.session.isAuthenticated()) {
            return false;
        }

        this.session.message = this.t('communities.errors.signInForAction', { action: this.t(`communities.authAction.${action}`) });
        void this.router.navigate(['/auth']);
        return true;
    }

    private applyDiscoverResults(communities: CommunityDto[]): void {
        this.discoverSourceCommunities = communities;
        this.rememberSuggestionSeed(communities);
        this.discoverCommunities = this.filterAndRankDiscover(communities, this.query);
        this.refreshSuggestions();
    }

    private filterAndRankDiscover(communities: ReadonlyArray<CommunityDto>, query: string): CommunityDto[] {
        return rankByDiscoveryQuery(communities, {
            query,
            minScore: 0,
            score: (community, expandedTerms) => this.communitySearchScore(community, expandedTerms),
            onEmptyQuery: items => [...items].sort((left, right) => right.memberCount - left.memberCount || left.name.localeCompare(right.name)),
            tieBreaker: (left, right) => right.memberCount - left.memberCount || left.name.localeCompare(right.name)
        });
    }

    private communitySearchScore(community: CommunityDto, expandedTerms: ReadonlyArray<string>): number {
        return scoreDiscoveryFields(expandedTerms, [
            { value: community.name, weight: 1.8 },
            { value: community.slug, weight: 1.4 },
            { value: community.description ?? '', weight: 1.2 },
            { value: community.createdByHandle, weight: 1.0 }
        ]);
    }

    private rememberSuggestionSeed(communities: ReadonlyArray<CommunityDto>): void {
        for (const community of communities.slice(0, 80)) {
            this.addSeed(community.slug);
            this.addSeed(community.name);
            this.addSeed(community.createdByHandle);
            this.addSeed(community.description ?? '');
        }
    }

    private addSeed(value: string): void {
        for (const token of value.split(/[^\p{L}\p{N}_-]+/u)) {
            const normalized = token.trim().toLowerCase();
            if (normalized.length < 3 || normalized.length > 32) {
                continue;
            }

            this.suggestionSeed.add(normalized);
        }
    }

    private refreshSuggestions(): void {
        this.suggestions = buildDiscoverySuggestions(this.query, Array.from(this.suggestionSeed), 8);
    }

    private shouldIgnoreCardNavigation(event: Event): boolean {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return false;
        }

        return !!target.closest('a, button, input, textarea, select, label, [role="button"]');
    }

    private t(key: string, params?: Record<string, unknown>): string {
        return this.translate.instant(key, params);
    }
}
