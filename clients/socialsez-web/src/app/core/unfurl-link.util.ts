import { environment } from '../../environments/environment';

const UNFURL_VERSION = '2026-03-08';

// Build a share URL that social crawlers can resolve on the API host.
// If API origin resolution fails, fall back to the app URL so links never break.
export function buildUnfurlShareUrl(targetPath: string): string {
    const normalizedTargetPath = normalizeTargetPath(targetPath);

    try {
        const apiOrigin = new URL(environment.apiBaseUrl).origin;
        const separator = normalizedTargetPath.includes('?') ? '&' : '?';
        return `${apiOrigin}/api/unfurl${normalizedTargetPath}${separator}v=${UNFURL_VERSION}`;
    } catch {
        if (typeof window === 'undefined') {
            return normalizedTargetPath;
        }

        return `${window.location.origin}${normalizedTargetPath}`;
    }
}

function normalizeTargetPath(targetPath: string): string {
    const trimmed = (targetPath ?? '').trim();
    if (!trimmed) {
        return '/';
    }

    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
