import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface SegmentedTabItem {
    id: string;
    label: string;
}

@Component({
    selector: 'app-segmented-tabs',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './segmented-tabs.component.html',
    styleUrl: './segmented-tabs.component.scss'
})
export class SegmentedTabsComponent {
    @Input() tabs: readonly SegmentedTabItem[] = [];
    @Input() activeTab = '';
    @Input() ariaLabel = 'Tabs';
    @Input() fullWidthOnMobile = false;

    @Output() activeTabChange = new EventEmitter<string>();

    onTabSelected(tabId: string): void {
        this.activeTabChange.emit(tabId);
    }
}