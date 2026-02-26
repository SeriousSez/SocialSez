import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnDestroy, Output, ViewChild, inject } from '@angular/core';
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
    @Input() popoverAlign: 'start' | 'end' = 'start';
    @Input() triggerStyle: 'default' | 'icon' | 'bubble-icon' = 'icon';

    @Output() primaryClick = new EventEmitter<void>();
    @Output() reactionSelected = new EventEmitter<string>();

    @ViewChild('zone') zoneRef?: ElementRef<HTMLDivElement>;
    @ViewChild('popover') popoverRef?: ElementRef<HTMLDivElement>;

    open = false;
    popoverReady = false;
    popoverClosing = false;
    resolvedPopoverAlign: 'start' | 'end' = 'start';
    resolvedPopoverVertical: 'top' | 'bottom' = 'top';
    popoverLeft = 0;
    popoverTop = 0;
    private openTimerId: number | null = null;
    private closeTimerId: number | null = null;
    private closeAnimationTimerId: number | null = null;
    private touchOpenTimerId: number | null = null;
    private activeTouchId: number | null = null;
    private touchLongPressTriggered = false;
    private touchStartX = 0;
    private touchStartY = 0;
    private readonly ngZone = inject(NgZone);
    private readonly onDocumentTouchMoveBound: (event: TouchEvent) => void;
    private readonly onDocumentTouchEndBound: (event: TouchEvent) => void;
    private readonly onDocumentTouchCancelBound: () => void;
    highlightedReactionType: string | null = null;

    constructor() {
        this.onDocumentTouchMoveBound = (event: TouchEvent) => {
            if (this.activeTouchId === null) {
                return;
            }

            this.ngZone.run(() => this.onDocumentTouchMove(event));
        };

        this.onDocumentTouchEndBound = (event: TouchEvent) => {
            if (this.activeTouchId === null) {
                return;
            }

            this.ngZone.run(() => this.onDocumentTouchEnd(event));
        };

        this.onDocumentTouchCancelBound = () => {
            if (this.activeTouchId === null) {
                return;
            }

            this.ngZone.run(() => this.onDocumentTouchCancel());
        };

        document.addEventListener('touchmove', this.onDocumentTouchMoveBound, { passive: false });
        document.addEventListener('touchend', this.onDocumentTouchEndBound);
        document.addEventListener('touchcancel', this.onDocumentTouchCancelBound);
    }

    ngOnDestroy(): void {
        this.clearTimers();
        this.clearCloseAnimationTimer();
        this.clearTouchOpenTimer();
        document.removeEventListener('touchmove', this.onDocumentTouchMoveBound);
        document.removeEventListener('touchend', this.onDocumentTouchEndBound);
        document.removeEventListener('touchcancel', this.onDocumentTouchCancelBound);
    }

    onPrimaryButtonClick(event: MouseEvent): void {
        if (this.touchLongPressTriggered) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        this.primaryClick.emit();
    }

    onHoverStart(): void {
        this.clearCloseTimer();
        this.clearCloseAnimationTimer();

        if (this.open) {
            this.popoverClosing = false;
            this.popoverReady = true;
            this.adjustPopoverAlignment();
            return;
        }

        this.clearOpenTimer();
        this.openTimerId = window.setTimeout(() => {
            this.open = true;
            this.popoverReady = false;
            this.popoverClosing = false;
            this.resolvedPopoverAlign = this.popoverAlign;
            this.resolvedPopoverVertical = 'top';
            this.openTimerId = null;
            window.setTimeout(() => {
                this.adjustPopoverAlignment();
                this.popoverReady = true;
                this.syncHoverStateAfterReady();
            }, 0);
        }, 500);
    }

    onHoverEnd(): void {
        this.clearOpenTimer();
        this.scheduleClose(420);
    }

    onPopoverHoverStart(): void {
        this.clearCloseTimer();
    }

    onPopoverHoverEnd(): void {
        this.scheduleClose(240);
    }

    pickReaction(type: string, event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        this.highlightedReactionType = null;
        this.closePopoverNow();
        this.reactionSelected.emit(type);
    }

    closePopoverNow(): void {
        this.clearTimers();
        this.clearTouchOpenTimer();
        this.clearCloseAnimationTimer();
        this.highlightedReactionType = null;
        this.open = false;
        this.popoverReady = false;
        this.popoverClosing = false;
    }

    onTouchStart(event: TouchEvent): void {
        if (this.busy || event.touches.length === 0) {
            return;
        }

        this.clearTouchOpenTimer();
        const firstTouch = event.touches[0];
        this.activeTouchId = firstTouch.identifier;
        this.touchStartX = firstTouch.clientX;
        this.touchStartY = firstTouch.clientY;
        this.touchLongPressTriggered = false;
        this.highlightedReactionType = null;

        this.touchOpenTimerId = window.setTimeout(() => {
            this.openTouchPopover(firstTouch.clientX, firstTouch.clientY);
            this.touchOpenTimerId = null;
        }, 420);
    }

    onDocumentTouchMove(event: TouchEvent): void {
        if (this.activeTouchId === null) {
            return;
        }

        const touch = this.findActiveTouch(event.touches);
        if (!touch) {
            return;
        }

        if (!this.touchLongPressTriggered) {
            const deltaX = touch.clientX - this.touchStartX;
            const deltaY = touch.clientY - this.touchStartY;
            const movedDistance = Math.hypot(deltaX, deltaY);
            if (movedDistance >= 8) {
                this.clearTouchOpenTimer();
                this.openTouchPopover(touch.clientX, touch.clientY);
            }
        }

        if (this.touchLongPressTriggered) {
            event.preventDefault();
            this.updateHighlightedReactionFromTouchPoint(touch.clientX, touch.clientY);
        }
    }

    onDocumentTouchEnd(event: TouchEvent): void {
        if (this.activeTouchId === null) {
            return;
        }

        const endedTouch = this.findActiveTouch(event.changedTouches);
        if (!endedTouch) {
            return;
        }

        const selectedReaction = this.highlightedReactionType;
        const hadLongPress = this.touchLongPressTriggered;

        this.clearTouchState();

        if (!hadLongPress) {
            this.primaryClick.emit();
            return;
        }

        if (selectedReaction) {
            this.pickReaction(selectedReaction);
            return;
        }

        this.closePopoverNow();
    }

    onDocumentTouchCancel(): void {
        if (this.activeTouchId === null) {
            return;
        }

        const hadLongPress = this.touchLongPressTriggered;
        this.clearTouchState();

        if (hadLongPress) {
            this.closePopoverNow();
        }
    }

    @HostListener('window:resize')
    onWindowResize(): void {
        if (!this.open) {
            return;
        }

        this.adjustPopoverAlignment();
    }

    emojiFor(type: string): string {
        return this.reactionOptions.find(x => x.type === type)?.emoji ?? '👍';
    }

    reactionIconClass(type: string): string {
        switch ((type ?? '').trim().toLowerCase()) {
            case 'like':
                return 'fa-duotone fa-solid fa-thumbs-up';
            case 'love':
                return 'fa-duotone fa-solid fa-heart';
            case 'laugh':
                return 'fa-duotone fa-solid fa-face-laugh-squint';
            case 'wow':
                return 'fa-duotone fa-solid fa-face-surprise';
            case 'sad':
                return 'fa-duotone fa-solid fa-face-sad-tear';
            case 'angry':
                return 'fa-duotone fa-solid fa-face-angry';
            case 'partyhorn':
            case 'party-horn':
            case 'party':
                return 'fa-duotone fa-solid fa-party-horn';
            case 'clap':
            case 'hands-clapping':
            case 'handsclapping':
                return 'fa-duotone fa-solid fa-hands-clapping';
            case 'fire':
                return 'fa-duotone fa-solid fa-fire';
            default:
                return 'fa-duotone fa-solid fa-thumbs-up';
        }
    }

    get buttonLabel(): string {
        if (this.myReactionType) {
            return this.emojiFor(this.myReactionType);
        }

        return this.emojiFor('Love');
    }

    private scheduleClose(delayMs = 180): void {
        this.clearCloseTimer();
        this.closeTimerId = window.setTimeout(() => {
            this.startCloseAnimation();
            this.closeTimerId = null;
        }, delayMs);
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

    private clearTouchOpenTimer(): void {
        if (this.touchOpenTimerId !== null) {
            window.clearTimeout(this.touchOpenTimerId);
            this.touchOpenTimerId = null;
        }
    }

    private clearTouchState(): void {
        this.clearTouchOpenTimer();
        this.activeTouchId = null;
        this.touchLongPressTriggered = false;
        this.touchStartX = 0;
        this.touchStartY = 0;
    }

    private openTouchPopover(clientX: number, clientY: number): void {
        if (this.touchLongPressTriggered) {
            this.updateHighlightedReactionFromTouchPoint(clientX, clientY);
            return;
        }

        this.touchLongPressTriggered = true;
        this.open = true;
        this.popoverReady = false;
        this.popoverClosing = false;
        this.resolvedPopoverAlign = this.popoverAlign;
        this.resolvedPopoverVertical = 'top';

        window.setTimeout(() => {
            this.adjustPopoverAlignment();
            this.popoverReady = true;
            this.updateHighlightedReactionFromTouchPoint(clientX, clientY);
        }, 0);
    }

    private findActiveTouch(touchList: TouchList): Touch | null {
        if (this.activeTouchId === null) {
            return null;
        }

        for (let index = 0; index < touchList.length; index++) {
            const touch = touchList.item(index);
            if (touch && touch.identifier === this.activeTouchId) {
                return touch;
            }
        }

        return null;
    }

    private updateHighlightedReactionFromTouchPoint(clientX: number, clientY: number): void {
        if (!this.open) {
            this.highlightedReactionType = null;
            return;
        }

        const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
        const reactionButton = element?.closest('.reaction-pop-btn') as HTMLElement | null;
        const nextReactionType = reactionButton?.dataset['reactionType'] ?? null;
        this.highlightedReactionType = nextReactionType;
    }

    private startCloseAnimation(): void {
        if (!this.open || this.popoverClosing) {
            return;
        }

        this.popoverClosing = true;
        this.clearCloseAnimationTimer();
        this.closeAnimationTimerId = window.setTimeout(() => {
            this.open = false;
            this.popoverReady = false;
            this.popoverClosing = false;
            this.closeAnimationTimerId = null;
        }, 120);
    }

    private clearCloseAnimationTimer(): void {
        if (this.closeAnimationTimerId !== null) {
            window.clearTimeout(this.closeAnimationTimerId);
            this.closeAnimationTimerId = null;
        }
    }

    private adjustPopoverAlignment(): void {
        const popover = this.popoverRef?.nativeElement;
        const zone = this.zoneRef?.nativeElement;
        if (!popover || !zone) {
            return;
        }

        const viewportPadding = 8;
        const boundaryElement = popover.closest('.message-list, .thread-list, .thread-scroll, .messages-panel, .message-panel') as HTMLElement | null;
        const boundaryRect = boundaryElement?.getBoundingClientRect();

        const rectLeft = Math.max(boundaryRect?.left ?? 0, 0);
        const rectRight = Math.min(boundaryRect?.right ?? window.innerWidth, window.innerWidth);
        const rectTop = Math.max(boundaryRect?.top ?? 0, 0);
        const rectBottom = Math.min(boundaryRect?.bottom ?? window.innerHeight, window.innerHeight);

        const minLeft = rectLeft + viewportPadding;
        const maxRight = rectRight - viewportPadding;
        const minTop = rectTop + viewportPadding;
        const maxBottom = rectBottom - viewportPadding;

        const zoneRect = zone.getBoundingClientRect();
        const popoverWidth = popover.offsetWidth;
        const popoverHeight = popover.offsetHeight;
        const verticalGap = 10;

        const startLeft = zoneRect.left;
        const startRight = startLeft + popoverWidth;
        const endLeft = zoneRect.right - popoverWidth;
        const endRight = zoneRect.right;

        const startFits = startLeft >= minLeft && startRight <= maxRight;
        const endFits = endLeft >= minLeft && endRight <= maxRight;

        const startOverflow = Math.max(0, minLeft - startLeft) + Math.max(0, startRight - maxRight);
        const endOverflow = Math.max(0, minLeft - endLeft) + Math.max(0, endRight - maxRight);

        let nextAlign: 'start' | 'end';
        if (this.popoverAlign === 'start') {
            if (startFits || !endFits) {
                nextAlign = 'start';
            } else {
                nextAlign = 'end';
            }
        } else if (endFits || !startFits) {
            nextAlign = 'end';
        } else {
            nextAlign = 'start';
        }

        if (!startFits && !endFits) {
            nextAlign = startOverflow <= endOverflow ? 'start' : 'end';
        }

        let nextVertical: 'top' | 'bottom' = 'top';

        const fitsAbove = (zoneRect.top - verticalGap - popoverHeight) >= minTop;
        const fitsBelow = (zoneRect.bottom + verticalGap + popoverHeight) <= maxBottom;

        if (!fitsAbove && fitsBelow) {
            nextVertical = 'bottom';
        }

        if (this.resolvedPopoverAlign !== nextAlign) {
            this.resolvedPopoverAlign = nextAlign;
        }

        if (this.resolvedPopoverVertical !== nextVertical) {
            this.resolvedPopoverVertical = nextVertical;
        }

        const maxPopoverLeft = Math.max(minLeft, maxRight - popoverWidth);
        const preferredLeft = nextAlign === 'start' ? zoneRect.left : (zoneRect.right - popoverWidth);
        const clampedLeft = Math.min(Math.max(preferredLeft, minLeft), maxPopoverLeft);

        const maxPopoverTop = Math.max(minTop, maxBottom - popoverHeight);
        const preferredTop = nextVertical === 'top'
            ? (zoneRect.top - verticalGap - popoverHeight)
            : (zoneRect.bottom + verticalGap);
        const clampedTop = Math.min(Math.max(preferredTop, minTop), maxPopoverTop);

        this.popoverLeft = Math.round(clampedLeft - zoneRect.left);
        this.popoverTop = Math.round(clampedTop - zoneRect.top);
    }

    private syncHoverStateAfterReady(): void {
        const zone = this.zoneRef?.nativeElement;
        const popover = this.popoverRef?.nativeElement;
        if (!zone || !popover) {
            return;
        }

        const hoveringZone = zone.matches(':hover');
        const hoveringPopover = popover.matches(':hover');

        if (hoveringZone || hoveringPopover) {
            this.clearCloseTimer();
            return;
        }

        this.scheduleClose(260);
    }
}