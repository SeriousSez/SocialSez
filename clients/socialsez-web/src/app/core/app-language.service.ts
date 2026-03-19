import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import { readStoredLanguagePreference, resolveDocumentDirection, resolveDocumentLanguage, resolveFormattingLocale, resolveTranslationLanguage } from './app-language.util';

@Injectable({ providedIn: 'root' })
export class AppLanguageService {
    private readonly translate = inject(TranslateService);
    private readonly languageChangesSource = new ReplaySubject<string>(1);
    private initialized = false;

    readonly languageChanges$ = this.languageChangesSource.asObservable();

    async initializeAsync(): Promise<void> {
        await this.applyPreferenceAsync(readStoredLanguagePreference(), true);
    }

    async applyStoredPreferenceAsync(): Promise<void> {
        await this.applyPreferenceAsync(readStoredLanguagePreference());
    }

    async applyPreferenceAsync(preference: string, force = false): Promise<void> {
        const translationLanguage = resolveTranslationLanguage(preference);
        const formattingLocale = resolveFormattingLocale(preference);

        this.applyDocumentLanguage(preference);
        this.translate.setFallbackLang('en');

        if (force || !this.initialized || this.translate.currentLang !== translationLanguage) {
            await firstValueFrom(this.translate.use(translationLanguage));
        }

        this.initialized = true;
        this.languageChangesSource.next(formattingLocale);
    }

    applyDocumentLanguage(preference: string): void {
        if (typeof document === 'undefined') {
            return;
        }

        document.documentElement.setAttribute('lang', resolveDocumentLanguage(preference));
        document.documentElement.setAttribute('dir', resolveDocumentDirection(preference));
    }
}
