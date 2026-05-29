import { expect, test } from '@playwright/test';

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

    test('mobile: footer blogs tab tap opens /blogs', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Mobile footer navigation only applies to mobile project.');

        await page.goto('/discover', { waitUntil: 'domcontentloaded' });
        const blogsTab = page.locator('.mobile-footer-tabs .mobile-footer-tab[routerlink="/blogs"]');
        await expect(blogsTab).toBeVisible();

        await blogsTab.tap();

        await expect.poll(() => new URL(page.url()).pathname).toBe('/blogs');
        await expect(page.locator('.blogs-page')).toBeVisible();
    });

    test('mobile: tapping blog card container opens blog page', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Tap interaction test is scoped to mobile project.');

        await page.goto('/blogs', { waitUntil: 'domcontentloaded' });

        const loadingGrid = page.locator('section.blog-grid[aria-label]');
        if (await loadingGrid.count()) {
            await expect(loadingGrid).toBeHidden({ timeout: 15000 });
        }

        const titleLinks = page.locator('.blog-grid .blog-card .blog-title');
        const linkCount = await titleLinks.count();
        test.skip(linkCount === 0, 'No published blog cards available in test environment for tap-to-open check.');

        const titleLink = titleLinks.first();
        await expect(titleLink).toBeVisible();

        const href = await titleLink.getAttribute('href');
        expect(href, 'Blog title link must have an href').toBeTruthy();

        const blogCard = titleLink.locator('xpath=ancestor::article[contains(@class,"blog-card")][1]');
        await expect(blogCard).toBeVisible();

        await blogCard.tap({ position: { x: 20, y: 20 } });

        const expectedPath = new URL(href ?? '', 'http://localhost').pathname;
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
});
