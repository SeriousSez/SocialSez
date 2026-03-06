import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CommunityDto, CommunityRuleDto } from '../core/api.types';

@Component({
    selector: 'app-community-info-rail',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    templateUrl: './community-info-rail.component.html',
    styleUrl: './community-info-rail.component.scss'
})
export class CommunityInfoRailComponent implements OnChanges {
    @Input() community: CommunityDto | null = null;
    @Input() loading = false;
    @Input() canEditRules = false;
    @Input() savingRules = false;

    @Output() rulesSaved = new EventEmitter<CommunityRuleDto[]>();

    editingRules = false;
    editableRules: CommunityRuleDto[] = [];
    private readonly expandedRuleIndices = new Set<number>();
    private pendingSave = false;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['community'] && this.pendingSave) {
            this.pendingSave = false;
            this.editingRules = false;
            this.expandedRuleIndices.clear();
            this.resetRulesDraft();
            return;
        }

        if (changes['savingRules'] && this.pendingSave && this.savingRules === false) {
            // Save finished without a community refresh, so keep editing open for correction/retry.
            this.pendingSave = false;
            return;
        }

        if (changes['community'] && !this.editingRules) {
            this.expandedRuleIndices.clear();
            this.resetRulesDraft();
        }
    }

    startRulesEdit(): void {
        if (!this.canEditRules || !this.community) {
            return;
        }

        this.editingRules = true;
        this.resetRulesDraft();
    }

    cancelRulesEdit(): void {
        this.editingRules = false;
        this.resetRulesDraft();
    }

    addRule(): void {
        if (this.editableRules.length >= 20) {
            return;
        }

        this.editableRules = [...this.editableRules, { text: '', description: '' }];
    }

    removeRule(index: number): void {
        this.editableRules = this.editableRules.filter((_, itemIndex) => itemIndex !== index);
    }

    canSaveRules(): boolean {
        if (this.savingRules) {
            return false;
        }

        return true;
    }

    saveRules(): void {
        if (!this.canSaveRules()) {
            return;
        }

        this.pendingSave = true;
        this.rulesSaved.emit(this.parseRules(this.editableRules));
    }

    trackRuleByIndex(index: number): number {
        return index;
    }

    toggleRuleExpanded(index: number): void {
        if (this.expandedRuleIndices.has(index)) {
            this.expandedRuleIndices.delete(index);
            return;
        }

        this.expandedRuleIndices.add(index);
    }

    isRuleExpanded(index: number): boolean {
        return this.expandedRuleIndices.has(index);
    }

    private resetRulesDraft(): void {
        this.editableRules = (this.community?.rules ?? []).map(rule => ({
            text: rule.text,
            description: rule.description ?? ''
        }));

        if (!this.editableRules.length) {
            this.editableRules = [{ text: '', description: '' }];
        }
    }

    private parseRules(rules: CommunityRuleDto[]): CommunityRuleDto[] {
        return rules
            .map(rule => ({
                text: (rule.text ?? '').trim(),
                description: rule.description?.trim() || undefined
            }))
            .filter(rule => !!rule.text);
    }
}
