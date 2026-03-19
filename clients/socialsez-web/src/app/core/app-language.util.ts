export type StoredLanguagePreference = 'system' | 'en-US' | 'en-GB' | 'da' | 'es' | 'de' | 'fr' | 'pt-BR' | 'nl' | 'sv' | 'nb' | 'it' | 'pl' | 'ar' | 'tr';
export type AppFormattingLocale = 'en-US' | 'en-GB' | 'da' | 'es' | 'de' | 'fr' | 'pt-BR' | 'nl' | 'sv' | 'nb' | 'it' | 'pl' | 'ar' | 'tr';
export type AppTranslationLanguage = 'en' | 'en-US' | 'en-GB' | 'da' | 'es' | 'de' | 'fr' | 'pt-BR' | 'nl' | 'sv' | 'nb' | 'it' | 'pl' | 'ar' | 'tr';

const prefsStorageKey = 'socialsez-web-prefs';

function normalizeLanguagePreference(value: string | null | undefined): StoredLanguagePreference {
    switch ((value ?? '').trim().toLowerCase()) {
        case 'en-us':
            return 'en-US';
        case 'en-gb':
            return 'en-GB';
        case 'da':
            return 'da';
        case 'es':
            return 'es';
        case 'de':
            return 'de';
        case 'fr':
            return 'fr';
        case 'pt-br':
            return 'pt-BR';
        case 'nl':
            return 'nl';
        case 'sv':
            return 'sv';
        case 'nb':
        case 'no':
            return 'nb';
        case 'it':
            return 'it';
        case 'pl':
            return 'pl';
        case 'ar':
            return 'ar';
        case 'tr':
            return 'tr';
        default:
            return 'system';
    }
}

function readNavigatorLocales(): string[] {
    if (typeof navigator === 'undefined') {
        return [];
    }

    return [navigator.language, ...(navigator.languages ?? [])]
        .filter((locale): locale is string => !!locale)
        .map(locale => locale.toLowerCase());
}

export function readStoredLanguagePreference(): StoredLanguagePreference {
    if (typeof localStorage === 'undefined') {
        return 'system';
    }

    try {
        const stored = localStorage.getItem(prefsStorageKey);
        if (!stored) {
            return 'system';
        }

        const parsed = JSON.parse(stored) as { language?: string };
        return normalizeLanguagePreference(parsed.language);
    } catch {
        return 'system';
    }
}

export function resolveFormattingLocale(preference: string = readStoredLanguagePreference()): AppFormattingLocale {
    const normalizedPreference = normalizeLanguagePreference(preference);
    if (normalizedPreference !== 'system') {
        return normalizedPreference;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const browserLocales = readNavigatorLocales();

    if (browserLocales.some(locale => locale.startsWith('da')) || timeZone === 'Europe/Copenhagen') {
        return 'da';
    }

    if (browserLocales.some(locale => locale.startsWith('fr'))) {
        return 'fr';
    }

    if (browserLocales.some(locale => locale.startsWith('pt'))) {
        return 'pt-BR';
    }

    if (browserLocales.some(locale => locale.startsWith('nl'))) {
        return 'nl';
    }

    if (browserLocales.some(locale => locale.startsWith('sv'))) {
        return 'sv';
    }

    if (browserLocales.some(locale => locale.startsWith('nb') || locale.startsWith('no'))) {
        return 'nb';
    }

    if (browserLocales.some(locale => locale.startsWith('it'))) {
        return 'it';
    }

    if (browserLocales.some(locale => locale.startsWith('pl'))) {
        return 'pl';
    }

    if (browserLocales.some(locale => locale.startsWith('ar'))) {
        return 'ar';
    }

    if (browserLocales.some(locale => locale.startsWith('tr'))) {
        return 'tr';
    }

    if (browserLocales.some(locale => locale.startsWith('es'))) {
        return 'es';
    }

    if (browserLocales.some(locale => locale.startsWith('de'))) {
        return 'de';
    }

    if (browserLocales.some(locale => locale.startsWith('en-gb'))) {
        return 'en-GB';
    }

    return 'en-US';
}

export function resolveTranslationLanguage(preference: string = readStoredLanguagePreference()): AppTranslationLanguage {
    const locale = resolveFormattingLocale(preference);
    if (locale === 'en-US') return 'en-US';
    if (locale === 'en-GB') return 'en-GB';
    if (locale === 'da') return 'da';
    if (locale === 'es') return 'es';
    if (locale === 'de') return 'de';
    if (locale === 'fr') return 'fr';
    if (locale === 'pt-BR') return 'pt-BR';
    if (locale === 'nl') return 'nl';
    if (locale === 'sv') return 'sv';
    if (locale === 'nb') return 'nb';
    if (locale === 'it') return 'it';
    if (locale === 'pl') return 'pl';
    if (locale === 'ar') return 'ar';
    if (locale === 'tr') return 'tr';
    return 'en';
}

export function resolveDocumentLanguage(preference: string = readStoredLanguagePreference()): string {
    return resolveFormattingLocale(preference);
}

export function resolveDocumentDirection(preference: string = readStoredLanguagePreference()): 'ltr' | 'rtl' {
    return resolveFormattingLocale(preference) === 'ar' ? 'rtl' : 'ltr';
}
