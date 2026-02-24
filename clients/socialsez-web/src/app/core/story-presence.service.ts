import { Injectable } from '@angular/core';
import { StoryGroupDto } from './api.types';
import { SessionService } from './session.service';

@Injectable({ providedIn: 'root' })
export class StoryPresenceService {
    constructor(private readonly session: SessionService) { }

    async loadActiveStoryGroups(): Promise<StoryGroupDto[]> {
        const [forYou, following] = await Promise.allSettled([
            this.session.loadStoryFeedAsync(80, 'for-you'),
            this.session.loadStoryFeedAsync(80, 'following')
        ]);

        const merged = [
            ...(forYou.status === 'fulfilled' ? forYou.value : []),
            ...(following.status === 'fulfilled' ? following.value : [])
        ];

        const deduped = new Map<string, StoryGroupDto>();
        for (const group of merged) {
            const key = group.authorId || this.normalizeHandle(group.authorHandle);
            if (!deduped.has(key)) {
                deduped.set(key, group);
            }
        }

        return Array.from(deduped.values());
    }

    hasActiveStoryForHandle(groups: ReadonlyArray<StoryGroupDto>, handle: string): boolean {
        const normalized = this.normalizeHandle(handle);
        return groups.some(group => this.normalizeHandle(group.authorHandle) === normalized);
    }

    hasUnseenStoryForHandle(groups: ReadonlyArray<StoryGroupDto>, handle: string): boolean {
        const normalized = this.normalizeHandle(handle);
        return groups.some(group => this.normalizeHandle(group.authorHandle) === normalized && group.hasUnseenStories);
    }

    getActiveStoryAuthorHandles(groups: ReadonlyArray<StoryGroupDto>): string[] {
        return groups.map(group => this.normalizeHandle(group.authorHandle));
    }

    getUnseenStoryAuthorHandles(groups: ReadonlyArray<StoryGroupDto>): string[] {
        return groups
            .filter(group => group.hasUnseenStories)
            .map(group => this.normalizeHandle(group.authorHandle));
    }

    private normalizeHandle(handle: string): string {
        return (handle ?? '').trim().toLowerCase();
    }
}