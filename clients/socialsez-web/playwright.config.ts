import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['PLAYWRIGHT_PORT'] ?? 4200);
const HOST = process.env['PLAYWRIGHT_HOST'] ?? '127.0.0.1';
const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? `http://${HOST}:${PORT}`;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env['CI'],
    retries: process.env['CI'] ? 2 : 0,
    workers: process.env['CI'] ? 2 : undefined,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'desktop-chromium',
            use: { ...devices['Desktop Chrome'] }
        },
        {
            name: 'mobile-chromium',
            use: { ...devices['Pixel 7'] }
        },
        {
            name: 'mobile-webkit-iphone',
            use: { ...devices['iPhone 13'] }
        }
    ],
    webServer: {
        command: `npm run start -- --host ${HOST} --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env['CI'],
        timeout: 120000
    }
});
