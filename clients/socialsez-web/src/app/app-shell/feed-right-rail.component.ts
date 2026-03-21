import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { EngagementStreakDto, HashtagSearchResultDto, ProfileActivitySummaryDto, ProfileDto } from '../core/api.types';
import { SessionService } from '../core/session.service';
import { SkeletonComponent } from '../shared/skeleton/skeleton.component';

interface ProfileSetupChecklistItem {
    key: 'avatar' | 'bio' | 'following' | 'firstPost';
    done: boolean;
    action: 'settings' | 'discover' | 'compose';
}

interface EngagementStreakState {
    current: number;
    best: number;
    lastActiveDate: string;
}

@Component({
    selector: 'app-feed-right-rail',
    standalone: true,
    imports: [CommonModule, RouterLink, TranslatePipe, SkeletonComponent],
    templateUrl: './feed-right-rail.component.html',
    styleUrl: './feed-right-rail.component.scss'
})
export class FeedRightRailComponent implements OnInit {
    private readonly session = inject(SessionService);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly translate = inject(TranslateService);

    private readonly profileSetupDismissStorageBaseKey = 'socialsez-web-feed-profile-setup-dismissed-v1';
    private readonly engagementStreakStorageBaseKey = 'socialsez-web-engagement-streak-v1';
    private readonly followSuggestionsDismissStorageBaseKey = 'socialsez-web-feed-follow-suggestions-dismissed-v1';
    private readonly hashtagSuggestionsDismissStorageBaseKey = 'socialsez-web-feed-hashtag-suggestions-dismissed-v1';

    loading = true;
    profileSetupDismissed = false;
    followSuggestionsDismissed = false;
    hashtagSuggestionsDismissed = false;
    profileActivitySummary: ProfileActivitySummaryDto | null = null;
    hasPostDraft = false;
    hasReelDraft = false;
    hasStoryDraft = false;
    followSuggestions: ProfileDto[] = [];
    followingSuggestionProfileId: string | null = null;
    hashtagSuggestions: HashtagSearchResultDto[] = [];
    followedHashtagTags: string[] = [];
    followingHashtagTag: string | null = null;
    private engagementStreakState: EngagementStreakState = { current: 0, best: 0, lastActiveDate: '' };

    ngOnInit(): void {
        this.loadDismissPreferences();
        void this.refreshAllAsync();

        this.session.appChanges$
            .pipe(
                filter(change => change === 'posts' || change === 'profile' || change === 'session'),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe((change) => {
                if (change === 'profile' || change === 'session') {
                    this.loadDismissPreferences();
                }

                void this.refreshAllAsync();
            });
    }

    get showEngagementStreakCard(): boolean {
        return this.session.isAuthenticated();
    }

    get engagementStreakCurrentDays(): number {
        return Math.max(0, this.engagementStreakState.current || 0);
    }

    get engagementStreakBestDays(): number {
        return Math.max(this.engagementStreakCurrentDays, this.engagementStreakState.best || 0);
    }

    get hasEngagementToday(): boolean {
        return this.engagementStreakState.lastActiveDate === this.getLocalDateKey();
    }

    get showDraftNudgeCard(): boolean {
        return this.session.isAuthenticated() && (this.hasPostDraft || this.hasReelDraft || this.hasStoryDraft);
    }

    get showFollowSuggestionsCard(): boolean {
        return this.session.isAuthenticated()
            && !this.followSuggestionsDismissed
            && this.followSuggestions.length > 0
            && this.followingCount < 10;
    }

    get showHashtagSuggestionsCard(): boolean {
        return this.session.isAuthenticated()
            && !this.hashtagSuggestionsDismissed
            && this.hashtagSuggestions.length > 0
            && this.followedHashtagTags.length < 5;
    }

    get showProfileSetupCard(): boolean {
        return !this.profileSetupDismissed && this.profileSetupCompletedCount < this.profileSetupTotalCount;
    }

    get hasProfileAvatar(): boolean {
        return !!this.session.profile?.imageUrl?.trim();
    }

    get hasProfileBio(): boolean {
        return !!this.session.profile?.bio?.trim();
    }

    get followingCount(): number {
        return this.profileActivitySummary?.followingCount ?? 0;
    }

    get postCount(): number {
        return this.profileActivitySummary?.postCount ?? 0;
    }

    get profileSetupChecklist(): readonly ProfileSetupChecklistItem[] {
        return [
            { key: 'avatar', done: this.hasProfileAvatar, action: 'settings' },
            { key: 'bio', done: this.hasProfileBio, action: 'settings' },
            { key: 'following', done: this.followingCount >= 3, action: 'discover' },
            { key: 'firstPost', done: this.postCount >= 1, action: 'compose' }
        ];
    }

    get profileSetupCompletedCount(): number {
        return this.profileSetupChecklist.filter(item => item.done).length;
    }

    get profileSetupTotalCount(): number {
        return this.profileSetupChecklist.length;
    }

    get profileSetupProgressPercent(): number {
        if (!this.profileSetupTotalCount) {
            return 0;
        }

        return Math.round((this.profileSetupCompletedCount / this.profileSetupTotalCount) * 100);
    }

    openEngagementStreakAction(): void {
        const composeParams = { compose: 'post', composeRequest: Date.now().toString() };
        const currentPath = this.router.url.split('?')[0] ?? '';

        if (currentPath === '/feed') {
            void this.router.navigate([], {
                queryParams: composeParams,
                queryParamsHandling: 'merge'
            });
            return;
        }

        void this.router.navigate(['/feed'], {
            queryParams: composeParams,
            queryParamsHandling: 'merge'
        });
    }

    openDraftsPage(): void {
        void this.router.navigate(['/drafts']);
    }

    dismissFollowSuggestionsCard(): void {
        this.followSuggestionsDismissed = true;
        this.writeStorageFlag(this.followSuggestionsDismissStorageBaseKey);
    }

    dismissHashtagSuggestionsCard(): void {
        this.hashtagSuggestionsDismissed = true;
        this.writeStorageFlag(this.hashtagSuggestionsDismissStorageBaseKey);
    }

    dismissProfileSetupCard(): void {
        this.profileSetupDismissed = true;
        this.writeStorageFlag(this.profileSetupDismissStorageBaseKey);
    }

    async followSuggestedProfile(profile: ProfileDto): Promise<void> {
        if (!profile?.id || this.followingSuggestionProfileId) {
            return;
        }

        this.followingSuggestionProfileId = profile.id;
        this.cdr.detectChanges();
        try {
            await this.session.followAsync(profile.id);
            this.followSuggestions = this.followSuggestions.filter(item => item.id !== profile.id);
            this.profileActivitySummary = {
                postCount: this.profileActivitySummary?.postCount ?? 0,
                followerCount: this.profileActivitySummary?.followerCount ?? 0,
                followingCount: (this.profileActivitySummary?.followingCount ?? 0) + 1
            };
            this.cdr.detectChanges();
            void this.refreshFollowSuggestionsAsync();
        } finally {
            this.followingSuggestionProfileId = null;
            this.cdr.detectChanges();
        }
    }

    async followSuggestedHashtag(tag: string): Promise<void> {
        const normalizedTag = (tag ?? '').trim().replace(/^#/, '').toLowerCase();
        if (!normalizedTag || this.followingHashtagTag) {
            return;
        }

        this.followingHashtagTag = normalizedTag;
        this.cdr.detectChanges();
        try {
            const followed = await this.session.followHashtagAsync(normalizedTag);
            const nextTag = (followed.tag ?? normalizedTag).trim().replace(/^#/, '').toLowerCase();
            this.followedHashtagTags = [nextTag, ...this.followedHashtagTags.filter(item => item !== nextTag)];
            this.hashtagSuggestions = this.hashtagSuggestions.filter(item => item.tag.trim().replace(/^#/, '').toLowerCase() !== nextTag);
            this.session.message = this.translate.instant('discover.status.followingHashtag', { tag: nextTag });
            this.cdr.detectChanges();
            void this.refreshHashtagSuggestionsAsync();
        } finally {
            this.followingHashtagTag = null;
            this.cdr.detectChanges();
        }
    }

    private async refreshAllAsync(): Promise<void> {
        if (!this.session.isAuthenticated()) {
            this.clearState();
            this.loading = false;
            this.cdr.detectChanges();
            return;
        }

        this.loading = true;
        this.cdr.detectChanges();

        await Promise.all([
            this.syncEngagementStreakFromApi(),
            this.refreshDraftNudgeState(),
            this.refreshFollowSuggestionsAsync(),
            this.refreshHashtagSuggestionsAsync(),
            this.refreshProfileActivitySummaryAsync()
        ]);

        this.loading = false;
        this.cdr.detectChanges();
    }

    private async refreshProfileActivitySummaryAsync(): Promise<void> {
        const profileHandle = (this.session.profile?.handle ?? '').trim();
        if (!profileHandle) {
            this.profileActivitySummary = null;
            this.cdr.detectChanges();
            return;
        }

        try {
            this.profileActivitySummary = await this.session.loadProfileActivitySummaryAsync(profileHandle);
        } catch {
            this.profileActivitySummary = null;
        }

        this.cdr.detectChanges();
    }

    private async syncEngagementStreakFromApi(): Promise<void> {
        try {
            const streak = await this.session.loadEngagementStreakAsync();
            this.applyEngagementStreakDto(streak);
        } catch {
            this.loadEngagementStreakStateFromStorage();
        }

        this.cdr.detectChanges();
    }

    private async refreshDraftNudgeState(): Promise<void> {
        const [postDraftsResult, reelDraftsResult, storyDraftsResult] = await Promise.allSettled([
            this.session.loadMyPostDraftsAsync(1),
            this.session.loadMyReelDraftsAsync(1),
            this.session.loadMyStoryDraftsAsync(1)
        ]);

        this.hasPostDraft = postDraftsResult.status === 'fulfilled' && postDraftsResult.value.length > 0;
        this.hasReelDraft = reelDraftsResult.status === 'fulfilled' && reelDraftsResult.value.length > 0;
        this.hasStoryDraft = storyDraftsResult.status === 'fulfilled' && storyDraftsResult.value.length > 0;
        this.cdr.detectChanges();
    }

    private async refreshFollowSuggestionsAsync(): Promise<void> {
        try {
            const suggestions = await this.session.loadFollowSuggestionsAsync(4);
            const merged = [...suggestions.relevant, ...suggestions.following];
            const currentProfileId = this.session.profile?.id;
            const seen = new Set<string>();
            this.followSuggestions = merged
                .filter(profile => {
                    if (!profile.id || profile.id === currentProfileId || seen.has(profile.id)) {
                        return false;
                    }

                    seen.add(profile.id);
                    return true;
                })
                .slice(0, 3);
        } catch {
            this.followSuggestions = [];
        }

        this.cdr.detectChanges();
    }

    private async refreshHashtagSuggestionsAsync(): Promise<void> {
        const [trendingResult, followedResult] = await Promise.allSettled([
            this.session.loadTrendingHashtagsAsync(8),
            this.session.loadFollowedHashtagsAsync(20)
        ]);

        const followedTags = followedResult.status === 'fulfilled'
            ? followedResult.value
                .map(item => (item.tag ?? '').trim().replace(/^#/, '').toLowerCase())
                .filter(tag => !!tag)
            : [];

        this.followedHashtagTags = followedTags;

        if (trendingResult.status !== 'fulfilled') {
            this.hashtagSuggestions = [];
            this.cdr.detectChanges();
            return;
        }

        const followedSet = new Set(followedTags);
        this.hashtagSuggestions = trendingResult.value
            .filter(item => {
                const normalizedTag = (item.tag ?? '').trim().replace(/^#/, '').toLowerCase();
                return !!normalizedTag && !followedSet.has(normalizedTag);
            })
            .slice(0, 5);

        this.cdr.detectChanges();
    }

    private loadDismissPreferences(): void {
        this.profileSetupDismissed = this.readStorageFlag(this.profileSetupDismissStorageBaseKey);
        this.followSuggestionsDismissed = this.readStorageFlag(this.followSuggestionsDismissStorageBaseKey);
        this.hashtagSuggestionsDismissed = this.readStorageFlag(this.hashtagSuggestionsDismissStorageBaseKey);
        this.loadEngagementStreakStateFromStorage();
    }

    private readStorageFlag(baseKey: string): boolean {
        try {
            return localStorage.getItem(this.storageKey(baseKey)) === '1';
        } catch {
            return false;
        }
    }

    private writeStorageFlag(baseKey: string): void {
        try {
            localStorage.setItem(this.storageKey(baseKey), '1');
        } catch {
        }
    }

    private loadEngagementStreakStateFromStorage(): void {
        try {
            const stored = localStorage.getItem(this.storageKey(this.engagementStreakStorageBaseKey));
            if (!stored) {
                this.engagementStreakState = { current: 0, best: 0, lastActiveDate: '' };
                return;
            }

            const parsed = JSON.parse(stored) as Partial<EngagementStreakState>;
            this.engagementStreakState = {
                current: Math.max(0, Number(parsed.current) || 0),
                best: Math.max(0, Number(parsed.best) || 0),
                lastActiveDate: typeof parsed.lastActiveDate === 'string' ? parsed.lastActiveDate : ''
            };
        } catch {
            this.engagementStreakState = { current: 0, best: 0, lastActiveDate: '' };
        }
    }

    private applyEngagementStreakDto(dto: EngagementStreakDto): void {
        this.engagementStreakState = {
            current: Math.max(0, Number(dto.currentDays) || 0),
            best: Math.max(0, Number(dto.bestDays) || 0),
            lastActiveDate: typeof dto.lastActiveDate === 'string' ? dto.lastActiveDate : ''
        };

        try {
            localStorage.setItem(this.storageKey(this.engagementStreakStorageBaseKey), JSON.stringify(this.engagementStreakState));
        } catch {
        }
    }

    private storageKey(baseKey: string): string {
        return `${baseKey}:${this.storageScopeKey()}`;
    }

    private storageScopeKey(): string {
        const profileId = (this.session.profile?.id ?? '').trim();
        if (profileId) {
            return profileId;
        }

        const profileHandle = (this.session.profile?.handle ?? '').trim().toLowerCase();
        if (profileHandle) {
            return `handle-${profileHandle}`;
        }

        return 'anonymous';
    }

    private clearState(): void {
        this.profileActivitySummary = null;
        this.hasPostDraft = false;
        this.hasReelDraft = false;
        this.hasStoryDraft = false;
        this.followSuggestions = [];
        this.hashtagSuggestions = [];
        this.followedHashtagTags = [];
        this.engagementStreakState = { current: 0, best: 0, lastActiveDate: '' };
    }

    private getLocalDateKey(value = new Date()): string {
        const year = value.getFullYear();
        const month = `${value.getMonth() + 1}`.padStart(2, '0');
        const day = `${value.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}