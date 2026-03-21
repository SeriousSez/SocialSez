import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { readStoredLanguagePreference } from '../../core/app-language.util';
import { SocialSezApiService } from '../../core/socialsez-api.service';

@Component({
    selector: 'app-translate-content',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    templateUrl: './translate-content.component.html',
    styleUrl: './translate-content.component.scss'
})
export class TranslateContentComponent implements OnChanges {
    private readonly api = inject(SocialSezApiService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly cdr = inject(ChangeDetectorRef);

    @Input() text: string = '';
    @Input() inlineMode = false;
    @Output() translationChanged = new EventEmitter<string | null>();

    translating = false;
    translated: string | null = null;
    failed = false;

    get hasContent(): boolean {
        return !!this.text?.trim();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (!changes['text']) {
            return;
        }

        this.translating = false;
        this.failed = false;
        this.translated = null;
        this.translationChanged.emit(null);
    }

    translate(): void {
        if (!this.hasContent || this.translating) return;

        const pref = readStoredLanguagePreference();
        const targetLanguage = pref === 'system' ? 'en-US' : pref;

        this.translating = true;
        this.failed = false;
        this.translated = null;

        this.api.translateContent(this.text, targetLanguage)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (res) => {
                    this.translated = res.translatedText || null;
                    this.translating = false;
                    this.translationChanged.emit(this.translated);
                    this.cdr.detectChanges();
                },
                error: () => {
                    this.failed = true;
                    this.translating = false;
                    this.translationChanged.emit(null);
                    this.cdr.detectChanges();
                }
            });
    }

    showOriginal(): void {
        this.translated = null;
        this.failed = false;
        this.translationChanged.emit(null);
    }
}
