import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { ReactionSummaryDto } from '../../core/api.types';

interface ReactionOption {
    type: string;
    emoji: string;
}

@Component({
    selector: 'app-reaction-picker',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './reaction-picker.component.html',
    styleUrl: './reaction-picker.component.scss'
})
export class ReactionPickerComponent implements OnDestroy {
    @Input({ required: true }) reactionOptions: readonly ReactionOption[] = [];
    @Input() reactions: ReadonlyArray<ReactionSummaryDto> = [];
    @Input() myReactionType: string | null | undefined;
    @Input() busy = false;
    @Input() primaryCount = 0;
    @Input() showCountWhenIdle = false;
    @Input() idleLabel = '🙂';

    @Output() primaryClick = new EventEmitter<void>();
    @Output() reactionSelected = new EventEmitter<string>();

    open = false;
    private openTimerId: number | null = null;
    private closeTimerId: number | null = null;

    ngOnDestroy(): void {
        this.clearTimers();
    }

    onHoverStart(): void {
        this.clearCloseTimer();
        if (this.open) {
            return;
        }

        this.clearOpenTimer();
        this.openTimerId = window.setTimeout(() => {
            this.open = true;
            this.openTimerId = null;
        }, 500);
    }

    onHoverEnd(): void {
        this.clearOpenTimer();
        this.scheduleClose();
    }

    onPopoverHoverStart(): void {
        this.clearCloseTimer();
    }

    onPopoverHoverEnd(): void {
        this.scheduleClose();
    }

    pickReaction(type: string): void {
        this.closePopoverNow();
        this.reactionSelected.emit(type);
    }

    closePopoverNow(): void {
        this.clearTimers();
        this.open = false;
    }

    emojiFor(type: string): string {
        return this.reactionOptions.find(x => x.type === type)?.emoji ?? '👍';
    }

    get buttonLabel(): string {
        if (this.myReactionType) {
            return this.emojiFor(this.myReactionType);
        }

        return this.emojiFor('Like');
    }

    private scheduleClose(): void {
        this.clearCloseTimer();
        this.closeTimerId = window.setTimeout(() => {
            this.open = false;
            this.closeTimerId = null;
        }, 180);
    }

    private clearOpenTimer(): void {
        if (this.openTimerId !== null) {
            window.clearTimeout(this.openTimerId);
            this.openTimerId = null;
        }
    }

    private clearCloseTimer(): void {
        if (this.closeTimerId !== null) {
            window.clearTimeout(this.closeTimerId);
            this.closeTimerId = null;
        }
    }

    private clearTimers(): void {
        this.clearOpenTimer();
        this.clearCloseTimer();
    }
}