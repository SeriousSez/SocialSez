import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

type ReportRootCategory = 'content' | 'account' | 'unlawful';

interface ReportOption {
    label: string;
    value: string;
}

interface ReportCategoryConfig {
    heading: string;
    options: ReportOption[];
}

@Component({
    selector: 'app-report-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './report-modal.component.html',
    styleUrl: './report-modal.component.scss'
})
export class ReportModalComponent implements OnChanges {
    @Input() open = false;
    @Input() busy = false;
    @Input() profileHandle = '';

    @Output() cancel = new EventEmitter<void>();
    @Output() submitReport = new EventEmitter<{ reason: string; details?: string }>();

    readonly rootOptions: ReadonlyArray<{ id: ReportRootCategory; label: string }> = [
        { id: 'content', label: 'Report Post, Message or Comment' },
        { id: 'account', label: 'Report Account' },
        { id: 'unlawful', label: 'Report as unlawful' }
    ];

    readonly categoryConfigs: Record<ReportRootCategory, ReportCategoryConfig> = {
        content: {
            heading: 'What is the problem with the content?',
            options: [
                { label: 'Spam or scam', value: 'Content: Spam or scam' },
                { label: 'Harassment or bullying', value: 'Content: Harassment or bullying' },
                { label: 'Hate speech', value: 'Content: Hate speech' },
                { label: 'Violence or dangerous acts', value: 'Content: Violence or dangerous acts' },
                { label: 'Nudity or sexual content', value: 'Content: Nudity or sexual content' },
                { label: 'False information', value: 'Content: False information' }
            ]
        },
        account: {
            heading: 'Why are you reporting this account?',
            options: [
                { label: 'Pretending to be someone else', value: 'Account: Impersonation' },
                { label: 'Fake account', value: 'Account: Fake account' },
                { label: 'Spam account', value: 'Account: Spam account' },
                { label: 'Harassment or bullying', value: 'Account: Harassment or bullying' },
                { label: 'Hate speech', value: 'Account: Hate speech' }
            ]
        },
        unlawful: {
            heading: 'What unlawful issue are you reporting?',
            options: [
                { label: 'Fraud or scam', value: 'Unlawful: Fraud or scam' },
                { label: 'Threats of violence', value: 'Unlawful: Threats of violence' },
                { label: 'Illegal goods or services', value: 'Unlawful: Illegal goods or services' },
                { label: 'Extortion or blackmail', value: 'Unlawful: Extortion or blackmail' },
                { label: 'Other legal violation', value: 'Unlawful: Other legal violation' }
            ]
        }
    };

    currentStep: 'root' | 'options' | 'custom' = 'root';
    selectedCategory: ReportRootCategory | null = null;
    customReason = '';
    customDetails = '';

    get rootHeading(): string {
        return this.profileHandle?.trim()
            ? `Why are you reporting @${this.profileHandle.trim()}?`
            : 'Why are you reporting this account?';
    }

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
