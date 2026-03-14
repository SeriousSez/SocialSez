const accessTokenKey = 'socialsez.accessToken';
const refreshTokenKey = 'socialsez.refreshToken';

function safeGet(storage: Storage, key: string): string {
    try {
        return storage.getItem(key) ?? '';
    } catch {
        return '';
    }
}

function safeSet(storage: Storage, key: string, value: string): void {
    try {
        storage.setItem(key, value);
    } catch {
    }
}

function safeRemove(storage: Storage, key: string): void {
    try {
        storage.removeItem(key);
    } catch {
    }
}

export function readAccessToken(): string {
    return safeGet(localStorage, accessTokenKey) || safeGet(sessionStorage, accessTokenKey);
}

export function readRefreshToken(): string {
    return safeGet(localStorage, refreshTokenKey) || safeGet(sessionStorage, refreshTokenKey);
}

export function hasLocalSessionTokens(): boolean {
    return !!safeGet(localStorage, accessTokenKey) && !!safeGet(localStorage, refreshTokenKey);
}

export function hasSessionStorageTokens(): boolean {
    return !!safeGet(sessionStorage, accessTokenKey) && !!safeGet(sessionStorage, refreshTokenKey);
}

export function writeSessionTokens(accessToken: string, refreshToken: string, staySignedIn: boolean): void {
    clearSessionTokens();

    if (staySignedIn) {
        safeSet(localStorage, accessTokenKey, accessToken);
        safeSet(localStorage, refreshTokenKey, refreshToken);
        return;
    }

    safeSet(sessionStorage, accessTokenKey, accessToken);
    safeSet(sessionStorage, refreshTokenKey, refreshToken);
}

export function clearSessionTokens(): void {
    safeRemove(localStorage, accessTokenKey);
    safeRemove(localStorage, refreshTokenKey);
    safeRemove(sessionStorage, accessTokenKey);
    safeRemove(sessionStorage, refreshTokenKey);
}