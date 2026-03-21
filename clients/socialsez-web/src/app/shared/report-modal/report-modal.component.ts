import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

type ReportRootCategory = 'content' | 'account' | 'unlawful';

interface ReportOption {
    labelKey: string;
    value: string;
}

interface ReportCategoryConfig {
    headingKey: string;
    options: ReportOption[];
}

@Component({
    selector: 'app-report-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule],
    templateUrl: './report-modal.component.html',
    styleUrl: './report-modal.component.scss'
})
export class ReportModalComponent implements OnChanges {
    @Input() open = false;
    @Input() busy = false;
    @Input() profileHandle = '';

    @Output() cancel = new EventEmitter<void>();
    @Output() submitReport = new EventEmitter<{ reason: string; details?: string }>();

    @ViewChild('reportCard')
    private reportCardRef?: ElementRef<HTMLElement>;

    @ViewChild('closeButton')
    private closeButtonRef?: ElementRef<HTMLButtonElement>;

    readonly rootOptions: ReadonlyArray<{ id: ReportRootCategory; labelKey: string }> = [
        { id: 'content', labelKey: 'reportModal.rootOptions.content' },
        { id: 'account', labelKey: 'reportModal.rootOptions.account' },
        { id: 'unlawful', labelKey: 'reportModal.rootOptions.unlawful' }
    ];

    readonly categoryConfigs: Record<ReportRootCategory, ReportCategoryConfig> = {
        content: {
            headingKey: 'reportModal.categoryHeadings.content',
            options: [
                { labelKey: 'reportModal.reasons.content.spam', value: 'content_spam_or_scam' },
                { labelKey: 'reportModal.reasons.content.harassment', value: 'content_harassment_or_bullying' },
                { labelKey: 'reportModal.reasons.content.hateSpeech', value: 'content_hate_speech' },
                { labelKey: 'reportModal.reasons.content.violence', value: 'content_violence_or_dangerous_acts' },
                { labelKey: 'reportModal.reasons.content.nudity', value: 'content_nudity_or_sexual_content' },
                { labelKey: 'reportModal.reasons.content.falseInfo', value: 'content_false_information' }
            ]
        },
        account: {
            headingKey: 'reportModal.categoryHeadings.account',
            options: [
                { labelKey: 'reportModal.reasons.account.impersonation', value: 'account_impersonation' },
                { labelKey: 'reportModal.reasons.account.fake', value: 'account_fake' },
                { labelKey: 'reportModal.reasons.account.spam', value: 'account_spam' },
                { labelKey: 'reportModal.reasons.account.harassment', value: 'account_harassment_or_bullying' },
                { labelKey: 'reportModal.reasons.account.hateSpeech', value: 'account_hate_speech' }
            ]
        },
        unlawful: {
            headingKey: 'reportModal.categoryHeadings.unlawful',
            options: [
                { labelKey: 'reportModal.reasons.unlawful.fraud', value: 'unlawful_fraud_or_scam' },
                { labelKey: 'reportModal.reasons.unlawful.threats', value: 'unlawful_threats_of_violence' },
                { labelKey: 'reportModal.reasons.unlawful.illegalGoods', value: 'unlawful_illegal_goods_or_services' },
                { labelKey: 'reportModal.reasons.unlawful.extortion', value: 'unlawful_extortion_or_blackmail' },
                { labelKey: 'reportModal.reasons.unlawful.other', value: 'unlawful_other_legal_violation' }
            ]
        }
    };

    currentStep: 'root' | 'options' | 'custom' = 'root';
    selectedCategory: ReportRootCategory | null = null;
    customReason = '';
    customDetails = '';
    private previouslyFocusedElement: HTMLElement | null = null;
    private scrollLocked = false;

    get selectedCategoryConfig(): ReportCategoryConfig | null {
        return this.selectedCategory ? this.categoryConfigs[this.selectedCategory] : null;
    }

    get canSubmitCustom(): boolean {
        return !!this.customReason.trim() && !this.busy;
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['open']?.currentValue) {
            this.resetState();
            this.previouslyFocusedElement = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            this.lockBackgroundScroll();
            window.setTimeout(() => this.focusInitialControl(), 0);
            return;
        }

        if (changes['open'] && changes['open'].currentValue === false) {
            this.unlockBackgroundScroll();
            this.restorePreviousFocus();
        }
    }

    ngOnDestroy(): void {
        this.unlockBackgroundScroll();
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (!this.open || this.busy) {
            return;
        }

        this.cancel.emit();
    }

    @HostListener('document:keydown.tab', ['$event'])
    onTabKey(event: Event): void {
        if (!this.open) {
            return;
        }

        if (!(event instanceof KeyboardEvent)) {
            return;
        }

        const focusable = this.getFocusableElements();
        if (focusable.length === 0) {
            event.preventDefault();
            return;
        }

        const activeElement = document.activeElement as HTMLElement | null;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
            return;
        }

        const focusInsideDialog = activeElement ? focusable.includes(activeElement) : false;
        if (!focusInsideDialog) {
            event.preventDefault();
            first.focus();
            return;
        }

        if (!event.shiftKey && activeElement === last) {
            event.preventDefault();
            first.focus();
            return;
        }

        if (event.shiftKey && activeElement === first) {
            event.preventDefault();
            last.focus();
        }
    }

    onBackdropClick(event: MouseEvent): void {
        if (this.busy) {
            return;
        }

        const target = event.target as HTMLElement;
        if (target.classList.contains('report-overlay')) {
            this.cancel.emit();
        }
    }

    chooseRootCategory(category: ReportRootCategory): void {
        this.selectedCategory = category;
        this.currentStep = 'options';
    }

    chooseReason(reason: string): void {
        if (this.busy) {
            return;
        }

        this.submitReport.emit({ reason });
    }

    openCustomReasonPage(): void {
        this.currentStep = 'custom';
    }

    goBack(): void {
        if (this.busy) {
            return;
        }

        if (this.currentStep === 'custom') {
            this.currentStep = 'options';
            return;
        }

        this.currentStep = 'root';
        this.selectedCategory = null;
    }

    submitCustomReason(): void {
        const reason = this.customReason.trim();
        if (!reason || this.busy) {
            return;
        }

        const customReasonKey = `custom_${this.selectedCategory ?? 'general'}`;
        const extraDetails = this.customDetails.trim();
        const details = extraDetails
            ? `${reason}\n\n${extraDetails}`
            : reason;

        this.submitReport.emit({ reason: customReasonKey, details });
    }

    private resetState(): void {
        this.currentStep = 'root';
        this.selectedCategory = null;
        this.customReason = '';
        this.customDetails = '';
    }

    private focusInitialControl(): void {
        const closeButton = this.closeButtonRef?.nativeElement;
        if (closeButton) {
            closeButton.focus();
            return;
        }

        const first = this.getFocusableElements()[0];
        first?.focus();
    }

    private getFocusableElements(): HTMLElement[] {
        const container = this.reportCardRef?.nativeElement;
        if (!container) {
            return [];
        }

        const selector = [
            'button:not([disabled])',
            '[href]',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', ');

        return Array.from(container.querySelectorAll<HTMLElement>(selector))
            .filter(element => !element.hasAttribute('disabled') && element.tabIndex >= 0);
    }

    private lockBackgroundScroll(): void {
        if (this.scrollLocked) {
            return;
        }

        document.body.style.overflow = 'hidden';
        this.scrollLocked = true;
    }

    private unlockBackgroundScroll(): void {
        if (!this.scrollLocked) {
            return;
        }

        document.body.style.overflow = '';
        this.scrollLocked = false;
    }

    private restorePreviousFocus(): void {
        const previous = this.previouslyFocusedElement;
        this.previouslyFocusedElement = null;
        previous?.focus();
    }
}
