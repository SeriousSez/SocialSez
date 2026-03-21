import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
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

    readonly rootOptions: ReadonlyArray<{ id: ReportRootCategory; labelKey: string }> = [
        { id: 'content', labelKey: 'reportModal.rootOptions.content' },
        { id: 'account', labelKey: 'reportModal.rootOptions.account' },
        { id: 'unlawful', labelKey: 'reportModal.rootOptions.unlawful' }
    ];

    readonly categoryConfigs: Record<ReportRootCategory, ReportCategoryConfig> = {
        content: {
            headingKey: 'reportModal.categoryHeadings.content',
            options: [
                { labelKey: 'reportModal.reasons.content.spam', value: 'Content: Spam or scam' },
                { labelKey: 'reportModal.reasons.content.harassment', value: 'Content: Harassment or bullying' },
                { labelKey: 'reportModal.reasons.content.hateSpeech', value: 'Content: Hate speech' },
                { labelKey: 'reportModal.reasons.content.violence', value: 'Content: Violence or dangerous acts' },
                { labelKey: 'reportModal.reasons.content.nudity', value: 'Content: Nudity or sexual content' },
                { labelKey: 'reportModal.reasons.content.falseInfo', value: 'Content: False information' }
            ]
        },
        account: {
            headingKey: 'reportModal.categoryHeadings.account',
            options: [
                { labelKey: 'reportModal.reasons.account.impersonation', value: 'Account: Impersonation' },
                { labelKey: 'reportModal.reasons.account.fake', value: 'Account: Fake account' },
                { labelKey: 'reportModal.reasons.account.spam', value: 'Account: Spam account' },
                { labelKey: 'reportModal.reasons.account.harassment', value: 'Account: Harassment or bullying' },
                { labelKey: 'reportModal.reasons.account.hateSpeech', value: 'Account: Hate speech' }
            ]
        },
        unlawful: {
            headingKey: 'reportModal.categoryHeadings.unlawful',
            options: [
                { labelKey: 'reportModal.reasons.unlawful.fraud', value: 'Unlawful: Fraud or scam' },
                { labelKey: 'reportModal.reasons.unlawful.threats', value: 'Unlawful: Threats of violence' },
                { labelKey: 'reportModal.reasons.unlawful.illegalGoods', value: 'Unlawful: Illegal goods or services' },
                { labelKey: 'reportModal.reasons.unlawful.extortion', value: 'Unlawful: Extortion or blackmail' },
                { labelKey: 'reportModal.reasons.unlawful.other', value: 'Unlawful: Other legal violation' }
            ]
        }
    };

    currentStep: 'root' | 'options' | 'custom' = 'root';
    selectedCategory: ReportRootCategory | null = null;
    customReason = '';
    customDetails = '';

    get selectedCategoryConfig(): ReportCategoryConfig | null {
        return this.selectedCategory ? this.categoryConfigs[this.selectedCategory] : null;
    }

    get canSubmitCustom(): boolean {
        return !!this.customReason.trim() && !this.busy;
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['open']?.currentValue) {
            this.resetState();
        }
    }

    @HostListener('document:keydown.escape')
    onEscape(): void {
        if (!this.open || this.busy) {
            return;
        }

        this.cancel.emit();
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

        const details = this.customDetails.trim();
        this.submitReport.emit({ reason, details: details || undefined });
    }

    private resetState(): void {
        this.currentStep = 'root';
        this.selectedCategory = null;
        this.customReason = '';
        this.customDetails = '';
    }
}
