import { resolveFormattingLocale } from './app-language.util';

function hasExplicitTimezone(value: string): boolean {
    return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

export function normalizeUtcDateString(value: string): string {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
        return trimmed;
    }

    return hasExplicitTimezone(trimmed) ? trimmed : `${trimmed}Z`;
}

export function parseUtcDate(value: string): Date {
    return new Date(normalizeUtcDateString(value));
}

export function normalizeUtcDateFields<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(item => normalizeUtcDateFields(item)) as T;
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const record = value as Record<string, unknown>;
    const normalizedEntries = Object.entries(record).map(([key, entryValue]) => {
        if (typeof entryValue === 'string' && key.endsWith('Utc')) {
            return [key, normalizeUtcDateString(entryValue)];
        }

        if (entryValue && typeof entryValue === 'object') {
            return [key, normalizeUtcDateFields(entryValue)];
        }

        return [key, entryValue];
    });

    return Object.fromEntries(normalizedEntries) as T;
}

export function resolveAppLocale(): string {
    return resolveFormattingLocale();
}

export function prefers24HourClock(): boolean {
    const hourCycle = new Intl.DateTimeFormat(resolveAppLocale(), { hour: 'numeric' }).resolvedOptions().hourCycle;
    return hourCycle === 'h23' || hourCycle === 'h24';
}

export function formatUtcDateTime(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!value) {
        return '';
    }

    const parsed = parseUtcDate(value);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat(resolveAppLocale(), options).format(parsed);
}