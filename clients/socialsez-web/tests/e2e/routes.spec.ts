import { expect, test } from '@playwright/test';

type RouteCase = {
    name: string;
    path: string;
    expectedPathPattern: RegExp;
};

const routeCases: ReadonlyArray<RouteCase> = [
    { name: 'root redirect', path: '/', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'auth page', path: '/auth', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'feed guard redirect', path: '/feed', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'discover page', path: '/discover', expectedPathPattern: /^\/discover(?:\?.*)?$/ },
    { name: 'communities page', path: '/communities', expectedPathPattern: /^\/communities(?:\?.*)?$/ },
    { name: 'community detail page', path: '/c/test-community', expectedPathPattern: /^\/c\/test-community(?:\?.*)?$/ },
    { name: 'chat guard redirect', path: '/chat', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'saved guard redirect', path: '/saved', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'drafts guard redirect', path: '/drafts', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'hashtag page', path: '/hashtags/dungeonkeep', expectedPathPattern: /^\/hashtags\/dungeonkeep(?:\?.*)?$/ },
    { name: 'profile guard redirect', path: '/profile', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'public profile page', path: '/users/dungeonmaster', expectedPathPattern: /^\/users\/dungeonmaster(?:\?.*)?$/ },
    { name: 'notifications guard redirect', path: '/notifications', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'notification requests guard redirect', path: '/notifications/requests', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'settings guard redirect', path: '/settings', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'blogs page', path: '/blogs', expectedPathPattern: /^\/blogs(?:\?.*)?$/ },
    { name: 'blog studio guard redirect', path: '/blogs/studio', expectedPathPattern: /^\/auth(?:\?.*)?$/ },
    { name: 'blog embed tools page', path: '/blogs/dungeonmaster/dungeonkeep/first-post/embed', expectedPathPattern: /^\/blogs\/dungeonmaster\/dungeonkeep\/first-post\/embed(?:\?.*)?$/ },
    { name: 'blog embed page', path: '/embed/blogs/dungeonmaster/dungeonkeep/first-post', expectedPathPattern: /^\/embed\/blogs\/dungeonmaster\/dungeonkeep\/first-post(?:\?.*)?$/ },
    { name: 'blog post page', path: '/blogs/dungeonmaster/dungeonkeep/first-post', expectedPathPattern: /^\/blogs\/dungeonmaster\/dungeonkeep\/first-post(?:\?.*)?$/ },
    { name: 'blog home page', path: '/blogs/dungeonmaster/dungeonkeep', expectedPathPattern: /^\/blogs\/dungeonmaster\/dungeonkeep(?:\?.*)?$/ },
    { name: 'blog author page', path: '/blogs/dungeonmaster', expectedPathPattern: /^\/blogs\/dungeonmaster(?:\?.*)?$/ },
    { name: 'shared post page', path: '/post/test-post-id', expectedPathPattern: /^\/post\/test-post-id(?:\?.*)?$/ },
    { name: 'shared community post page', path: '/cp/test-community-post-id', expectedPathPattern: /^\/cp\/test-community-post-id(?:\?.*)?$/ },
    { name: 'shared reel page', path: '/reel/test-reel-id', expectedPathPattern: /^\/reel\/test-reel-id(?:\?.*)?$/ },
    { name: 'shared story page', path: '/story/test-story-id', expectedPathPattern: /^\/story\/test-story-id(?:\?.*)?$/ },
    { name: 'legacy community redirect', path: '/communities/test-community', expectedPathPattern: /^\/c\/test-community(?:\?.*)?$/ },
    { name: 'legacy shared post redirect', path: '/shared/post/test-post-id', expectedPathPattern: /^\/post\/test-post-id(?:\?.*)?$/ },
    { name: 'legacy shared community post redirect', path: '/shared/community-post/test-community-post-id', expectedPathPattern: /^\/cp\/test-community-post-id(?:\?.*)?$/ },
    { name: 'legacy shared reel redirect', path: '/shared/reel/test-reel-id', expectedPathPattern: /^\/reel\/test-reel-id(?:\?.*)?$/ },
    { name: 'legacy shared story redirect', path: '/shared/story/test-story-id', expectedPathPattern: /^\/story\/test-story-id(?:\?.*)?$/ },
    { name: 'fallback redirect', path: '/not-a-real-route', expectedPathPattern: /^\/blogs(?:\?.*)?$/ }
];

test.describe('Route matrix smoke coverage', () => {
    for (const routeCase of routeCases) {
        test(`opens ${routeCase.name}`, async ({ page }) => {
            const response = await page.goto(routeCase.path, { waitUntil: 'domcontentloaded' });
            expect(response, `No response for route: ${routeCase.path}`).not.toBeNull();

            await expect.poll(() => {
                const pathname = new URL(page.url()).pathname;
                const search = new URL(page.url()).search;
                return `${pathname}${search}`;
            }).toMatch(routeCase.expectedPathPattern);

            await expect(page.locator('body')).toBeVisible();
        });
    }
});
