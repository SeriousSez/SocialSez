import { expect, Page, Route, test } from '@playwright/test';

const mockBlogOwnerHandle = 'dungeonmaster';
const mockBlogSlug = 'dungeonkeep';
const mockBlogPostSlug = 'first-post';

const mockBlog = {
    id: 'blog-1',
    ownerProfileId: 'profile-1',
    ownerHandle: mockBlogOwnerHandle,
    slug: mockBlogSlug,
    title: 'DungeonKeep',
    description: 'A campaign companion for tabletop adventures.',
    isPublic: true,
    allowLikes: true,
    allowComments: true,
    allowShares: true,
    allowEmbeds: true,
    theme: {
        fontFamily: 'Cinzel, Georgia, serif',
        accentColor: '#c86f1a',
        backgroundColor: '#f6f1e7',
        surfaceColor: '#fffaf2',
        darkAccentColor: '#ffb36b',
        darkBackgroundColor: '#0f1222',
        darkSurfaceColor: '#161b31',
        headerLayout: 'hero-split',
        postListLayout: 'timeline',
        customCss: ''
    },
    createdAtUtc: '2026-05-29T00:00:00Z',
    updatedAtUtc: '2026-05-29T00:00:00Z',
    isOwner: false
};

const mockBlogPost = {
    id: 'post-1',
    blogId: 'blog-1',
    blogSlug: mockBlogSlug,
    authorProfileId: 'profile-1',
    authorHandle: mockBlogOwnerHandle,
    slug: mockBlogPostSlug,
    title: 'Welcome to DungeonKeep',
    content: '# Welcome\n\nThis is a test post.',
    excerpt: 'This is a test post.',
    coverImageUrl: null,
    tags: ['dungeonkeep'],
    isPublished: true,
    createdAtUtc: '2026-05-29T00:00:00Z',
    updatedAtUtc: '2026-05-29T00:00:00Z',
    publishedAtUtc: '2026-05-29T00:00:00Z',
    isOwner: false,
    isSavedByMe: false
};

const mockAuthResponse = {
    token: 'playwright-access-token',
    expiresAtUtc: '2026-06-29T00:00:00Z',
    refreshToken: 'playwright-refresh-token',
    refreshTokenExpiresAtUtc: '2026-06-29T00:00:00Z',
    profile: {
        id: 'profile-1',
        handle: mockBlogOwnerHandle,
        displayName: 'Dungeon Master',
        bio: '',
        isPrivate: false,
        createdAtUtc: '2026-05-29T00:00:00Z'
    }
};

async function mockBlogsDiscoveryAsync(page: Page): Promise<void> {
    await page.route('**/blogs/discover**', (route: Route) => route.fulfill({ json: [mockBlog] }));
}

async function mockSignedInBlogsSessionAsync(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.setItem('socialsez.accessToken', 'playwright-access-token');
        localStorage.setItem('socialsez.refreshToken', 'playwright-refresh-token');
    });

    await page.route('**/auth/refresh', (route: Route) => route.fulfill({ json: mockAuthResponse }));
    await page.route('**/blogs/mine**', (route: Route) => route.fulfill({ json: [mockBlog] }));
    await mockBlogsDiscoveryAsync(page);
}

async function mockBlogDetailAsync(page: Page): Promise<void> {
    await page.route(`**/blogs/${mockBlogOwnerHandle}/${mockBlogSlug}`, (route: Route) => route.fulfill({ json: mockBlog }));
    await page.route(`**/blogs/${mockBlogOwnerHandle}/${mockBlogSlug}/posts`, (route: Route) => route.fulfill({ json: [mockBlogPost] }));
}

test.describe('Interactive navigation flows', () => {
    test('desktop: left rail blogs nav click opens /blogs', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Desktop left rail is hidden on mobile viewport.');

        await page.goto('/discover', { waitUntil: 'domcontentloaded' });

        const blogsNav = page.locator('.tabs .tab-blogs');
        await expect(blogsNav).toBeVisible();

        await blogsNav.click();

        await expect.poll(() => new URL(page.url()).pathname).toBe('/blogs');
        await expect(page.locator('.blogs-page')).toBeVisible();
    });

    test('desktop: blogs filter tab click updates selected state', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Desktop-only behavior check.');

        await page.goto('/blogs', { waitUntil: 'domcontentloaded' });

        const tabs = page.locator('.blogs-toolbar .tabs button');
        await expect(tabs.first()).toBeVisible();

        const firstTab = tabs.nth(0);
        const secondTab = tabs.nth(1);

        await secondTab.click();
        await expect(secondTab).toHaveClass(/active/);

        await firstTab.click();
        await expect(firstTab).toHaveClass(/active/);
    });

    test('desktop: open blog studio button click opens /blogs/studio', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Desktop-only behavior check.');

        await mockSignedInBlogsSessionAsync(page);

        await page.goto('/blogs', { waitUntil: 'domcontentloaded' });

        const openStudioLink = page.locator('.blogs-head .studio-link');
        await expect(openStudioLink).toBeVisible();

        await openStudioLink.click();

        await expect.poll(() => new URL(page.url()).pathname).toBe('/blogs/studio');
        await expect(page.locator('app-blog-studio-page')).toBeVisible();
    });

    test('desktop: sort dropdown button click changes sort option', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Desktop-only behavior check.');

        await mockBlogsDiscoveryAsync(page);
        await page.goto('/blogs', { waitUntil: 'domcontentloaded' });

        const sortToggle = page.locator('.sort-toggle');
        await expect(sortToggle).toBeVisible();

        const initialLabel = (await sortToggle.innerText()).trim();
        await sortToggle.click();

        const sortMenu = page.locator('.sort-menu');
        await expect(sortMenu).toBeVisible();

        const sortOptions = sortMenu.locator('button');
        await expect(sortOptions).toHaveCount(3);

        await sortOptions.nth(2).click();

        await expect.poll(async () => (await sortToggle.innerText()).trim()).not.toBe(initialLabel);
        await expect(sortMenu).toBeHidden();
    });

    test('mobile: footer blogs tab tap opens /blogs', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Mobile footer navigation only applies to mobile project.');

        await page.goto('/discover', { waitUntil: 'domcontentloaded' });
        const blogsTab = page.locator('.mobile-footer-tabs .mobile-footer-tab[routerlink="/blogs"]');
        await expect(blogsTab).toBeVisible();

        await blogsTab.tap();

        await expect.poll(() => new URL(page.url()).pathname).toBe('/blogs');
        await expect(page.locator('.blogs-page')).toBeVisible();
    });

    test('mobile: footer discover tab tap works from /blogs', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Mobile footer navigation only applies to mobile project.');

        await mockBlogsDiscoveryAsync(page);

        await page.goto('/blogs', { waitUntil: 'domcontentloaded' });

        const discoverTab = page.locator('.mobile-footer-tabs .mobile-footer-tab[routerlink="/discover"]');
        await expect(discoverTab).toBeVisible();

        await discoverTab.tap();

        await expect.poll(() => new URL(page.url()).pathname).toBe('/discover');
        await expect(page.locator('body')).toBeVisible();
    });

    test('mobile: tapping blog card container opens blog page', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Tap interaction test is scoped to mobile project.');

        await mockBlogsDiscoveryAsync(page);
        await mockBlogDetailAsync(page);

        await page.goto('/blogs', { waitUntil: 'domcontentloaded' });

        const titleLinks = page.locator('.blog-grid .blog-card .blog-title');
        await expect(titleLinks.first()).toBeVisible();
        const titleLink = titleLinks.first();

        const href = await titleLink.getAttribute('href');
        expect(href, 'Blog title link must have an href').toBeTruthy();

        const blogCard = titleLink.locator('xpath=ancestor::article[contains(@class,"blog-card")][1]');
        await expect(blogCard).toBeVisible();

        await blogCard.tap({ position: { x: 20, y: 20 } });

        const expectedPath = new URL(href ?? '', page.url()).pathname;
        await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
        await expect(page.locator('body')).toBeVisible();
    });

    test('mobile: more menu communities tap opens /communities', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'More menu exists in mobile footer flow.');

        await page.goto('/blogs', { waitUntil: 'domcontentloaded' });

        const moreTrigger = page.locator('.mobile-footer-more-trigger');
        await expect(moreTrigger).toBeVisible();
        await moreTrigger.click();

        const moreMenu = page.locator('.mobile-footer-more-menu');
        await expect(moreMenu).toBeVisible();

        const communitiesMenuItem = page.locator('.mobile-footer-more-menu .mobile-footer-more-item').first();
        await expect(communitiesMenuItem).toBeVisible();
        await communitiesMenuItem.tap();

        await expect.poll(() => new URL(page.url()).pathname).toBe('/communities');
        await expect(page.locator('body')).toBeVisible();
    });

    test('mobile: update alert action button is tappable', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Update alert tap behavior is mobile-specific regression coverage.');

        await page.goto('/blogs?e2eShowUpdateNotice=1&e2eNoReload=1', { waitUntil: 'domcontentloaded' });

        const updateActionButton = page.locator('.top-notice .top-notice-action');
        await expect(updateActionButton).toBeVisible();
        const initialLabel = (await updateActionButton.innerText()).trim();
        expect(initialLabel.length, 'Update action should have a non-empty initial label.').toBeGreaterThan(0);
        await updateActionButton.tap();
        await expect.poll(async () => {
            const nextLabel = (await updateActionButton.innerText()).trim();
            return nextLabel !== initialLabel;
        }).toBe(true);
    });
});
