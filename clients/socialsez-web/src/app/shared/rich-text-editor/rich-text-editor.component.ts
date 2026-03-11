import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-rich-text-editor, app-comment-editor',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './rich-text-editor.component.html',
    styleUrl: './rich-text-editor.component.scss'
})
export class RichTextEditorComponent implements OnChanges, AfterViewInit {
    @ViewChild('richEditor') richEditor?: ElementRef<HTMLDivElement>;
    @ViewChild('markdownTextarea') markdownTextarea?: ElementRef<HTMLTextAreaElement>;
    @ViewChild('linkUrlInput') linkUrlInput?: ElementRef<HTMLInputElement>;

    @Input() placeholder = 'Join the conversation';
    @Input() submitLabel = 'Comment';
    @Input() submittingLabel = 'Posting...';
    @Input() submitting = false;
    @Input() errorMessage = '';
    @Input() collapsed = false;
    @Input() showActions = true;
    @Input() showModeToggle = true;
    @Input() editorHeightPx: number | null = null;
    @Input() initialContent = '';
    @Input() initialContentIsHtml = false;
    @Input() resetToken = 0;

    @Output() submitted = new EventEmitter<string>();
    @Output() cancelled = new EventEmitter<void>();
    @Output() contentChanged = new EventEmitter<string>();

    expanded = !this.collapsed;
    editorMode: 'markdown' | 'rich' = 'rich';
    markdownDraft = '';

    isBoldCommandActive = false;
    isItalicCommandActive = false;
    isLinkCommandActive = false;
    isUnorderedListCommandActive = false;
    isOrderedListCommandActive = false;
    isQuoteCommandActive = false;
    isSpoilerCommandActive = false;

    mentionResults: ProfileDto[] = [];
    mentionOpen = false;
    mentionLoading = false;

    linkModalOpen = false;
    linkModalUrl = '';
    linkModalTarget: '_blank' | '_self' | '_parent' | '_top' | 'custom' = '_blank';
    linkModalCustomTarget = '';
    linkModalError = '';

    private mentionRangeStart = -1;
    private mentionRangeEnd = -1;
    private mentionSearchDebounceId: number | null = null;
    private mentionSearchToken = 0;
    private pendingRichMentionRange: Range | null = null;
    private pendingLinkSelectionRange: Range | null = null;

    private readonly defaultSpoilerPlaceholder = '|';
    private lastAppliedInitial = '';

    constructor(
        private readonly cdr: ChangeDetectorRef,
        private readonly ngZone: NgZone,
        private readonly session: SessionService
    ) {
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['collapsed']) {
            this.expanded = !this.collapsed;
        }

        if (changes['resetToken'] && !changes['resetToken'].firstChange) {
            this.resetComposer();
        }

        if (changes['initialContent']) {
            const next = this.initialContent ?? '';
            if (next !== this.lastAppliedInitial) {
                this.applyInitialContent(next);
                this.lastAppliedInitial = next;
            }
        }
    }

    ngAfterViewInit(): void {
        const next = this.initialContent ?? '';
        if (!next) {
            return;
        }

        this.applyInitialContent(next);
        this.lastAppliedInitial = next;
        this.refreshView();
    }

    get canSubmit(): boolean {
        return !!this.getContent();
    }

    expand(): void {
        if (this.expanded) {
            return;
        }

        this.expanded = true;
        this.refreshView();
        window.setTimeout(() => {
            this.focusActiveEditor();
        }, 0);
    }

    onCancel(): void {
        if (this.submitting) {
            return;
        }

        this.resetComposer();
        this.cancelled.emit();
    }

    onMarkdownInput(value: string, textarea: HTMLTextAreaElement): void {
        this.markdownDraft = value;
        this.emitLiveContent();
        this.updateMentionSuggestions(value, textarea.selectionStart ?? value.length);
    }

    onMarkdownCursor(textarea: HTMLTextAreaElement): void {
        this.updateMentionSuggestions(this.markdownDraft, textarea.selectionStart ?? this.markdownDraft.length);
    }

    onEditorBlur(): void {
        window.setTimeout(() => {
            this.closeMentionSuggestions();
        }, 120);
    }

    async selectMention(profile: ProfileDto): Promise<void> {
        if (!this.mentionOpen) {
            return;
        }

        const replacement = `@${profile.handle} `;

        if (this.editorMode === 'markdown') {
            if (this.mentionRangeStart < 0 || this.mentionRangeEnd < this.mentionRangeStart) {
                return;
            }

            const mergedContent = `${this.markdownDraft.slice(0, this.mentionRangeStart)}${replacement}${this.markdownDraft.slice(this.mentionRangeEnd)}`;
            this.markdownDraft = mergedContent;
            this.emitLiveContent();

            const nextCaret = this.mentionRangeStart + replacement.length;
            this.closeMentionSuggestions();

            await Promise.resolve();
            const textarea = this.markdownTextarea?.nativeElement;
            if (!textarea) {
                return;
            }

            textarea.focus();
            textarea.setSelectionRange(nextCaret, nextCaret);
            return;
        }

        const editor = this.richEditor?.nativeElement;
        const mentionRange = this.pendingRichMentionRange;
        if (!editor || !mentionRange) {
            return;
        }

        const replacementNode = document.createTextNode(replacement);
        mentionRange.deleteContents();
        mentionRange.insertNode(replacementNode);

        const selection = window.getSelection();
        if (selection) {
            const cursor = document.createRange();
            cursor.setStart(replacementNode, replacementNode.textContent?.length ?? replacement.length);
            cursor.collapse(true);
            selection.removeAllRanges();
            selection.addRange(cursor);
        }

        this.pendingRichMentionRange = null;
        this.closeMentionSuggestions();
        this.updateRichCommandStates();
        this.refreshView();
        this.emitLiveContent();
        editor.focus();
    }

    onSubmit(): void {
        if (this.submitting) {
            return;
        }

        const content = this.getContent();
        if (!content) {
            return;
        }

        this.submitted.emit(content);
    }

    async toggleEditorMode(): Promise<void> {
        if (this.editorMode === 'markdown') {
            const markdown = this.markdownDraft;
            this.editorMode = 'rich';
            this.resetRichCommandStates();
            this.expanded = true;
            this.refreshView();
            await Promise.resolve();
            if (this.richEditor) {
                this.richEditor.nativeElement.innerHTML = this.markdownToRichHtml(markdown);
                this.richEditor.nativeElement.focus();
                this.updateRichCommandStates();
            }
            return;
        }

        this.markdownDraft = this.readRichText();
        this.editorMode = 'markdown';
        this.resetRichCommandStates();
        this.refreshView();
    }

    applyRichCommand(command: 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'formatBlock' | 'createLink' | 'spoiler'): void {
        if (this.editorMode !== 'rich') {
            return;
        }

        if (command === 'spoiler') {
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) {
                return;
            }

            const editor = this.richEditor?.nativeElement;
            if (!editor) {
                return;
            }

            const activeSpoiler = this.findActiveSpoilerNode(selection.anchorNode, editor);
            if (activeSpoiler && this.isSpoilerCommandActive) {
                this.unwrapSpoilerKeepingText(activeSpoiler, selection);
                this.updateRichCommandStates();
                this.refreshView();
                return;
            }

            const selectedText = selection.toString() ?? '';
            const hasSelectedText = selectedText.length > 0;
            const spoilerText = hasSelectedText ? selectedText : this.defaultSpoilerPlaceholder;
            const range = selection.getRangeAt(0);
            range.deleteContents();

            const spoiler = document.createElement('span');
            spoiler.className = 'compose-spoiler';
            spoiler.setAttribute('data-spoiler', 'true');
            spoiler.textContent = spoilerText;

            range.insertNode(spoiler);
            this.ensureSpaceAfterInlineNode(spoiler);
            if (hasSelectedText) {
                this.placeCaretAtEndOfNode(spoiler);
            } else {
                this.selectNodeContents(spoiler);
            }
            this.updateRichCommandStates();
            this.refreshView();
            return;
        }

        if (command === 'createLink') {
            this.openLinkModal();
            return;
        }

        if (command === 'formatBlock') {
            const selection = window.getSelection();
            const editor = this.richEditor?.nativeElement;
            const activeQuote = selection && editor
                ? this.findAncestorTag(selection.anchorNode, editor, 'BLOCKQUOTE')
                : null;

            if (activeQuote) {
                this.unwrapQuoteKeepingText(activeQuote, selection);
                this.updateRichCommandStates();
                this.refreshView();
                return;
            }

            const usedAngleBrackets = document.execCommand('formatBlock', false, '<blockquote>');
            if (!usedAngleBrackets) {
                const usedPlainTag = document.execCommand('formatBlock', false, 'blockquote');
                if (!usedPlainTag) {
                    const selectedText = window.getSelection()?.toString().trim() ?? '';
                    const fallbackHtml = selectedText
                        ? `<blockquote>${selectedText}</blockquote>`
                        : '<blockquote><br></blockquote>';
                    document.execCommand('insertHTML', false, fallbackHtml);
                }
            }

            this.updateRichCommandStates();
            this.refreshView();
            return;
        }

        document.execCommand(command, false);
        this.updateRichCommandStates();
        this.refreshView();
    }

    onRichEditorKeydown(event: KeyboardEvent): void {
        if (this.editorMode !== 'rich') {
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            setTimeout(() => this.cleanupEmptyComposeSpoilers(), 0);
        }

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || !selection.isCollapsed) {
            return;
        }

        const editor = this.richEditor?.nativeElement;
        if (!editor) {
            return;
        }

        const spoiler = this.findAncestorWithClass(selection.anchorNode, editor, 'compose-spoiler');
        if (spoiler && this.isSpoilerEffectivelyEmpty(spoiler) && this.isPlainTypingKey(event)) {
            event.preventDefault();
            this.unwrapEmptySpoilerAndInsertText(spoiler, event.key);
            return;
        }

        if (spoiler && this.isCaretAtEndOfNode(selection, spoiler)) {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                this.placeCaretAfterInlineNode(spoiler);
                this.updateRichCommandStates();
                return;
            }
        }

        if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') {
            return;
        }

        const quote = this.findAncestorTag(selection.anchorNode, editor, 'BLOCKQUOTE');
        if (!quote || !this.isCaretAtEndOfNode(selection, quote)) {
            return;
        }

        const exitPoint = this.ensureExitPointAfterNode(quote, editor);
        if (!exitPoint) {
            return;
        }

        event.preventDefault();
        this.placeCaretAtStart(exitPoint);
    }

    onRichEditorInput(): void {
        this.normalizeComposeSpoilerSpans();
        this.cleanupEmptyComposeSpoilers();
        this.updateRichCommandStates();
        this.updateRichMentionSuggestions();
        this.emitLiveContent();
    }

    onRichEditorFocus(): void {
        this.updateRichCommandStates();
        this.updateRichMentionSuggestions();
    }

    onRichEditorKeyup(): void {
        this.updateRichCommandStates();
        this.updateRichMentionSuggestions();
    }

    onRichEditorMouseup(): void {
        setTimeout(() => this.updateRichCommandStates(), 0);
        setTimeout(() => this.updateRichMentionSuggestions(), 0);
    }

    onRichToolbarMouseDown(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('button')) {
            return;
        }

        event.preventDefault();
        this.richEditor?.nativeElement.focus();
    }

    onRichToolbarPointerDown(event: PointerEvent): void {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('button')) {
            return;
        }

        event.preventDefault();
        this.richEditor?.nativeElement.focus();
    }

    onRichEditorMousedown(event: MouseEvent): void {
        if (this.editorMode !== 'rich') {
            return;
        }

        const editor = this.richEditor?.nativeElement;
        if (!editor || event.target !== editor) {
            return;
        }

        const lastElement = editor.lastElementChild;
        if (!lastElement || lastElement.tagName !== 'BLOCKQUOTE') {
            return;
        }

        const exitPoint = this.ensureExitPointAfterNode(lastElement, editor);
        if (!exitPoint) {
            return;
        }

        event.preventDefault();
        this.placeCaretAtStart(exitPoint);
        this.updateRichCommandStates();
    }

    closeLinkModal(): void {
        this.linkModalOpen = false;
        this.linkModalError = '';
        this.pendingLinkSelectionRange = null;
        this.focusActiveEditor();
    }

    submitLinkModal(): void {
        const normalizedUrl = this.normalizeLinkUrl(this.linkModalUrl);
        if (!normalizedUrl) {
            this.linkModalError = 'Enter a valid URL.';
            return;
        }

        if (!this.restorePendingLinkSelection()) {
            this.linkModalError = 'Select text in the editor before adding a link.';
            return;
        }

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            this.linkModalError = 'Select text in the editor before adding a link.';
            return;
        }

        const range = selection.getRangeAt(0);
        if (range.collapsed) {
            const textNode = document.createTextNode(normalizedUrl);
            range.insertNode(textNode);
            const linkRange = document.createRange();
            linkRange.selectNodeContents(textNode);
            selection.removeAllRanges();
            selection.addRange(linkRange);
        }

        document.execCommand('createLink', false, normalizedUrl);
        this.applySelectionLinkAttributes(this.resolveLinkTargetValue());
        this.linkModalOpen = false;
        this.linkModalError = '';
        this.pendingLinkSelectionRange = null;
        this.updateRichCommandStates();
        this.refreshView();
        this.emitLiveContent();
        this.focusActiveEditor();
    }

    private resetComposer(): void {
        this.markdownDraft = '';
        this.editorMode = 'rich';
        this.resetRichCommandStates();
        this.closeMentionSuggestions();
        this.pendingRichMentionRange = null;
        if (this.richEditor) {
            this.richEditor.nativeElement.innerHTML = '';
        }

        this.expanded = !this.collapsed;
        this.refreshView();
        this.emitLiveContent();
    }

    private applyInitialContent(content: string): void {
        this.closeMentionSuggestions();
        this.pendingRichMentionRange = null;
        if (this.initialContentIsHtml) {
            const editorHtml = this.storageHtmlToEditorHtml(content);
            this.markdownDraft = this.editorHtmlToText(editorHtml);
            if (this.editorMode === 'rich' && this.richEditor) {
                this.richEditor.nativeElement.innerHTML = editorHtml;
            }
            return;
        }

        this.markdownDraft = content;
        if (this.editorMode === 'rich' && this.richEditor) {
            this.richEditor.nativeElement.innerHTML = this.markdownToRichHtml(content);
        }

        this.emitLiveContent();
    }

    private storageHtmlToEditorHtml(content: string): string {
        return (content ?? '').replace(/\|\|([\s\S]+?)\|\|/g, (_match, spoilerText) =>
            `<span class="compose-spoiler" data-spoiler="true">${spoilerText}</span>`);
    }

    private editorHtmlToText(editorHtml: string): string {
        const working = document.createElement('div');
        working.innerHTML = editorHtml;

        const spoilerNodes = working.querySelectorAll('span');
        for (const node of spoilerNodes) {
            if (!(node instanceof HTMLElement) || !this.isSpoilerLikeElement(node)) {
                continue;
            }

            const text = (node.textContent ?? '').trim();
            const replacement = document.createTextNode(text ? `||${text}||` : '');
            node.parentNode?.replaceChild(replacement, node);
        }

        const raw = working.innerText ?? '';
        return raw
            .replace(/\u200B/g, '')
            .replace(/\u00A0/g, ' ')
            .replace(/\r/g, '')
            .trim();
    }

    private getContent(): string {
        if (this.editorMode === 'markdown') {
            return this.markdownDraft.trim();
        }

        const serialized = this.readRichContent();
        return this.hasMeaningfulSerializedContent(serialized) ? serialized : '';
    }

    private updateRichMentionSuggestions(): void {
        const editor = this.richEditor?.nativeElement;
        const selection = window.getSelection();
        if (!editor || !selection || !selection.rangeCount || !selection.isCollapsed) {
            this.pendingRichMentionRange = null;
            this.closeMentionSuggestions();
            return;
        }

        const anchorNode = selection.anchorNode;
        if (!anchorNode) {
            this.pendingRichMentionRange = null;
            this.closeMentionSuggestions();
            return;
        }

        const textNode = anchorNode.nodeType === Node.TEXT_NODE
            ? anchorNode
            : (anchorNode.childNodes[selection.anchorOffset - 1] ?? null);

        if (!textNode || textNode.nodeType !== Node.TEXT_NODE || !editor.contains(textNode)) {
            this.pendingRichMentionRange = null;
            this.closeMentionSuggestions();
            return;
        }

        const text = textNode.textContent ?? '';
        const caretOffset = anchorNode.nodeType === Node.TEXT_NODE
            ? selection.anchorOffset
            : text.length;
        const beforeCaret = text.slice(0, caretOffset);
        const match = beforeCaret.match(/(^|\s)@([\p{L}\p{N}_]{1,30})$/u);
        if (!match) {
            this.pendingRichMentionRange = null;
            this.closeMentionSuggestions();
            return;
        }

        const query = match[2] ?? '';
        if (!query) {
            this.pendingRichMentionRange = null;
            this.closeMentionSuggestions();
            return;
        }

        const atIndex = beforeCaret.lastIndexOf('@');
        if (atIndex < 0) {
            this.pendingRichMentionRange = null;
            this.closeMentionSuggestions();
            return;
        }

        const range = document.createRange();
        range.setStart(textNode, atIndex);
        range.setEnd(textNode, caretOffset);
        this.pendingRichMentionRange = range;

        this.searchMentionProfiles(query);
    }

    private updateMentionSuggestions(value: string, caret: number): void {
        const context = this.extractMentionContext(value, caret);
        if (!context || !context.query) {
            this.closeMentionSuggestions();
            return;
        }

        this.mentionRangeStart = context.start;
        this.mentionRangeEnd = caret;
        this.searchMentionProfiles(context.query);
    }

    private searchMentionProfiles(query: string): void {
        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }

        this.mentionLoading = true;
        const token = ++this.mentionSearchToken;
        this.mentionSearchDebounceId = window.setTimeout(async () => {
            this.mentionSearchDebounceId = null;

            try {
                const profiles = await this.session.searchProfilesAsync(query);
                if (token !== this.mentionSearchToken) {
                    return;
                }

                const currentHandle = this.session.profile?.handle.toLowerCase() ?? '';
                this.mentionResults = profiles.filter(profile => profile.handle.toLowerCase() !== currentHandle).slice(0, 6);
                this.mentionOpen = this.mentionResults.length > 0;
            } catch {
                if (token !== this.mentionSearchToken) {
                    return;
                }

                this.mentionResults = [];
                this.mentionOpen = false;
            } finally {
                if (token === this.mentionSearchToken) {
                    this.mentionLoading = false;
                }
            }
        }, 200);
    }

    private closeMentionSuggestions(): void {
        this.mentionOpen = false;
        this.mentionResults = [];
        this.mentionLoading = false;
        this.mentionRangeStart = -1;
        this.mentionRangeEnd = -1;
        this.mentionSearchToken += 1;

        if (this.mentionSearchDebounceId !== null) {
            window.clearTimeout(this.mentionSearchDebounceId);
            this.mentionSearchDebounceId = null;
        }
    }

    private extractMentionContext(value: string, caret: number): { query: string; start: number } | null {
        const prefix = value.slice(0, caret);
        const match = prefix.match(/(^|\s)@([\p{L}\p{N}_]{1,30})$/u);
        if (!match) {
            return null;
        }

        const query = match[2] ?? '';
        if (!query) {
            return null;
        }

        return {
            query,
            start: caret - query.length - 1
        };
    }

    private emitLiveContent(): void {
        if (this.editorMode === 'markdown') {
            this.lastAppliedInitial = this.markdownDraft;
            this.contentChanged.emit(this.markdownDraft);
            return;
        }

        const serialized = this.readRichContent();
        this.lastAppliedInitial = serialized;
        this.contentChanged.emit(serialized);
    }

    private hasMeaningfulSerializedContent(serialized: string): boolean {
        if (!serialized.trim()) {
            return false;
        }

        const probe = document.createElement('div');
        probe.innerHTML = serialized;
        const text = (probe.textContent ?? '')
            .replace(/\u00A0/g, ' ')
            .replace(/\u200B/g, '')
            .trim();

        return text.length > 0;
    }

    private readRichContent(): string {
        const source = this.richEditor?.nativeElement;
        if (!source) {
            return '';
        }

        const working = document.createElement('div');
        working.innerHTML = source.innerHTML;

        const markerNodes = working.querySelectorAll('span[data-caret-marker="true"]');
        for (const marker of markerNodes) {
            marker.remove();
        }

        const spoilerNodes = working.querySelectorAll('span');
        for (const node of spoilerNodes) {
            if (!(node instanceof HTMLElement) || !this.isSpoilerLikeElement(node)) {
                continue;
            }

            const text = (node.textContent ?? '').trim();
            const replacement = document.createTextNode(text ? `||${text}||` : '');
            node.parentNode?.replaceChild(replacement, node);
        }

        return working.innerHTML.trim();
    }

    private readRichText(): string {
        const source = this.richEditor?.nativeElement;
        if (!source) {
            return '';
        }

        const working = document.createElement('div');
        working.innerHTML = source.innerHTML;
        const spoilerNodes = working.querySelectorAll('span');
        for (const node of spoilerNodes) {
            if (!(node instanceof HTMLElement) || !this.isSpoilerLikeElement(node)) {
                continue;
            }

            const text = (node.textContent ?? '').trim();
            const replacement = document.createTextNode(text ? `||${text}||` : '');
            node.parentNode?.replaceChild(replacement, node);
        }

        const raw = working.innerText ?? '';
        return raw
            .replace(/\u200B/g, '')
            .replace(/\u00A0/g, ' ')
            .replace(/\r/g, '')
            .trim();
    }

    private markdownToRichHtml(markdown: string): string {
        const escaped = markdown
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const withSpoilers = escaped.replace(/\|\|([\s\S]+?)\|\|/g, (_match, spoilerText) =>
            `<span class="compose-spoiler" data-spoiler="true">${spoilerText}</span>`);

        return withSpoilers.replace(/\n/g, '<br>');
    }

    private findAncestorTag(node: Node | null, boundary: HTMLElement, tagName: string): HTMLElement | null {
        let cursor: Node | null = node;
        while (cursor && cursor !== boundary) {
            if (cursor instanceof HTMLElement && cursor.tagName === tagName) {
                return cursor;
            }

            cursor = cursor.parentNode;
        }

        return null;
    }

    private findAncestorWithClass(node: Node | null, boundary: HTMLElement, className: string): HTMLElement | null {
        let cursor: Node | null = node;
        while (cursor && cursor !== boundary) {
            if (cursor instanceof HTMLElement && cursor.classList.contains(className)) {
                return cursor;
            }

            cursor = cursor.parentNode;
        }

        return null;
    }

    private isCaretAtEndOfNode(selection: Selection, node: Node): boolean {
        if (!selection.rangeCount) {
            return false;
        }

        const caret = selection.getRangeAt(0);
        const end = document.createRange();
        end.selectNodeContents(node);
        end.collapse(false);

        return caret.compareBoundaryPoints(Range.START_TO_START, end) === 0
            && caret.compareBoundaryPoints(Range.END_TO_END, end) === 0;
    }

    private ensureExitPointAfterNode(node: Element, editor: HTMLElement): HTMLElement | null {
        let next = node.nextElementSibling as HTMLElement | null;
        while (next && next.tagName === 'BLOCKQUOTE') {
            next = next.nextElementSibling as HTMLElement | null;
        }

        if (next) {
            return next;
        }

        const paragraph = document.createElement('p');
        paragraph.appendChild(document.createElement('br'));
        editor.insertBefore(paragraph, node.nextSibling);
        return paragraph;
    }

    private placeCaretAtStart(node: HTMLElement): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richEditor?.nativeElement.focus();
        const range = document.createRange();
        range.setStart(node, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private placeCaretAfterInlineNode(node: Node): Text | null {
        const anchor = this.ensureTextAnchorAfterInlineNode(node);
        if (!anchor) {
            return null;
        }

        const offset = anchor.textContent?.length ?? 0;
        this.placeCaretAtTextOffset(anchor, offset);
        return anchor;
    }

    private ensureTextAnchorAfterInlineNode(node: Node): Text | null {
        const parent = node.parentNode;
        if (!parent) {
            return null;
        }

        const next = node.nextSibling;
        if (next instanceof Text) {
            return next;
        }

        const anchor = document.createTextNode('');
        parent.insertBefore(anchor, next);
        return anchor;
    }

    private ensureSpaceAfterInlineNode(node: Node): Text | null {
        const anchor = this.ensureTextAnchorAfterInlineNode(node);
        if (!anchor) {
            return null;
        }

        if (!anchor.textContent || anchor.textContent.length === 0) {
            anchor.textContent = '\u00A0';
            return anchor;
        }

        return anchor;
    }

    private isPlainTypingKey(event: KeyboardEvent): boolean {
        return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    }

    private isSpoilerEffectivelyEmpty(spoiler: HTMLElement): boolean {
        const value = (spoiler.textContent ?? '')
            .replace(/\uFEFF/g, '')
            .replace(/\u2060/g, '')
            .replace(/\u00A0/g, '')
            .replace(/\u200B/g, '')
            .trim();
        return value.length === 0;
    }

    private cleanupEmptyComposeSpoilers(): void {
        if (this.editorMode !== 'rich') {
            return;
        }

        const editor = this.richEditor?.nativeElement;
        if (!editor) {
            return;
        }

        const selection = window.getSelection();
        const activeNode = selection?.anchorNode ?? null;
        const spoilerNodes = Array.from(editor.querySelectorAll('span'));

        for (const spoilerNode of spoilerNodes) {
            if (!(spoilerNode instanceof HTMLElement) || !this.isSpoilerLikeElement(spoilerNode) || !this.isSpoilerEffectivelyEmpty(spoilerNode)) {
                continue;
            }

            const wasActive = !!activeNode && spoilerNode.contains(activeNode);
            const anchor = this.ensureTextAnchorAfterInlineNode(spoilerNode);
            spoilerNode.remove();

            if (wasActive && anchor) {
                this.placeCaretAtTextOffset(anchor, 0);
            }
        }
    }

    private normalizeComposeSpoilerSpans(): void {
        const editor = this.richEditor?.nativeElement;
        if (!editor) {
            return;
        }

        const spans = Array.from(editor.querySelectorAll('span'));
        for (const span of spans) {
            if (!(span instanceof HTMLElement) || !this.isSpoilerLikeElement(span)) {
                continue;
            }

            span.classList.add('compose-spoiler');
            span.setAttribute('data-spoiler', 'true');
            span.style.backgroundColor = '';
        }
    }

    private openLinkModal(): void {
        const editor = this.richEditor?.nativeElement;
        const selection = window.getSelection();
        if (!editor || !selection || !selection.rangeCount) {
            return;
        }

        this.pendingLinkSelectionRange = selection.getRangeAt(0).cloneRange();
        const activeLink = this.findAncestorTag(selection.anchorNode, editor, 'A');
        if (activeLink instanceof HTMLAnchorElement) {
            this.linkModalUrl = activeLink.getAttribute('href') ?? activeLink.href ?? '';
            const existingTarget = (activeLink.getAttribute('target') ?? '').trim();
            if (!existingTarget || existingTarget === '_blank' || existingTarget === '_self' || existingTarget === '_parent' || existingTarget === '_top') {
                this.linkModalTarget = (existingTarget || '_blank') as '_blank' | '_self' | '_parent' | '_top';
                this.linkModalCustomTarget = '';
            } else {
                this.linkModalTarget = 'custom';
                this.linkModalCustomTarget = existingTarget;
            }
        } else {
            this.linkModalUrl = '';
            this.linkModalTarget = '_blank';
            this.linkModalCustomTarget = '';
        }

        this.linkModalError = '';
        this.linkModalOpen = true;
        this.refreshView();
        window.setTimeout(() => {
            this.linkUrlInput?.nativeElement.focus();
            this.linkUrlInput?.nativeElement.select();
        }, 0);
    }

    private restorePendingLinkSelection(): boolean {
        if (!this.pendingLinkSelectionRange) {
            return false;
        }

        const editor = this.richEditor?.nativeElement;
        if (!editor) {
            return false;
        }

        const selection = window.getSelection();
        if (!selection) {
            return false;
        }

        editor.focus();
        selection.removeAllRanges();
        selection.addRange(this.pendingLinkSelectionRange);
        return true;
    }

    private applySelectionLinkAttributes(target: string): void {
        const editor = this.richEditor?.nativeElement;
        const selection = window.getSelection();
        if (!editor || !selection || !selection.rangeCount) {
            return;
        }

        const links = new Set<HTMLAnchorElement>();

        const anchorAncestor = this.findAncestorTag(selection.anchorNode, editor, 'A');
        if (anchorAncestor instanceof HTMLAnchorElement) {
            links.add(anchorAncestor);
        }

        const focusAncestor = this.findAncestorTag(selection.focusNode, editor, 'A');
        if (focusAncestor instanceof HTMLAnchorElement) {
            links.add(focusAncestor);
        }

        if (!links.size) {
            const allLinks = editor.querySelectorAll('a[href]');
            if (allLinks.length) {
                const latestLink = allLinks[allLinks.length - 1];
                if (latestLink instanceof HTMLAnchorElement) {
                    links.add(latestLink);
                }
            }
        }

        for (const link of links) {
            link.setAttribute('target', target);
            if (target === '_blank') {
                link.setAttribute('rel', 'noopener noreferrer');
            } else {
                link.removeAttribute('rel');
            }
        }
    }

    private resolveLinkTargetValue(): string {
        if (this.linkModalTarget !== 'custom') {
            return this.linkModalTarget;
        }

        const custom = this.linkModalCustomTarget.trim();
        return custom || '_blank';
    }

    private normalizeLinkUrl(rawValue: string): string | null {
        const trimmed = (rawValue ?? '').trim();
        if (!trimmed) {
            return null;
        }

        const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

        try {
            const parsed = new URL(candidate);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return null;
            }

            return parsed.toString();
        } catch {
            return null;
        }
    }

    private isSpoilerLikeElement(element: HTMLElement): boolean {
        if (element.classList.contains('compose-spoiler')) {
            return true;
        }

        if (element.getAttribute('data-spoiler') === 'true') {
            return true;
        }

        const inlineBg = (element.style.backgroundColor || '').replace(/\s+/g, '').toLowerCase();
        return inlineBg === 'rgb(183,192,203)' || inlineBg === '#b7c0cb' || inlineBg === 'rgba(183,192,203,1)';
    }

    private findActiveSpoilerNode(node: Node | null, boundary: HTMLElement): HTMLElement | null {
        let cursor: Node | null = node;
        while (cursor && cursor !== boundary) {
            if (cursor instanceof HTMLElement && this.isSpoilerLikeElement(cursor)) {
                return cursor;
            }

            cursor = cursor.parentNode;
        }

        return null;
    }

    private unwrapEmptySpoilerAndInsertText(spoiler: HTMLElement, text: string): void {
        const anchor = this.ensureTextAnchorAfterInlineNode(spoiler);
        spoiler.remove();

        if (!anchor) {
            document.execCommand('insertText', false, text);
            return;
        }

        anchor.insertData(0, text);
        this.placeCaretAtTextOffset(anchor, text.length);
    }

    private unwrapSpoilerKeepingText(spoiler: HTMLElement, selection: Selection): void {
        const text = spoiler.textContent ?? '';
        if (text === this.defaultSpoilerPlaceholder) {
            const anchor = this.ensureTextAnchorAfterInlineNode(spoiler);
            spoiler.remove();

            if (!anchor) {
                return;
            }

            if (anchor.textContent?.startsWith('\u00A0')) {
                anchor.deleteData(0, 1);
            }

            this.placeCaretAtTextOffset(anchor, 0);
            return;
        }

        const parent = spoiler.parentNode;
        if (!parent) {
            return;
        }

        const caretOffset = this.getSelectionOffsetInsideNode(selection, spoiler);
        const replacement = document.createTextNode(text);
        parent.replaceChild(replacement, spoiler);

        this.placeCaretAtTextOffset(replacement, Math.min(caretOffset, replacement.length));
    }

    private unwrapQuoteKeepingText(quote: HTMLElement, selection: Selection | null): void {
        const parent = quote.parentNode;
        if (!parent) {
            return;
        }

        let marker: HTMLElement | null = null;
        if (selection?.rangeCount && selection.anchorNode && quote.contains(selection.anchorNode)) {
            marker = document.createElement('span');
            marker.setAttribute('data-caret-marker', 'true');
            marker.style.display = 'inline-block';
            marker.style.width = '0';
            marker.style.overflow = 'hidden';

            const markerRange = selection.getRangeAt(0).cloneRange();
            markerRange.collapse(true);
            markerRange.insertNode(marker);
        }

        const fragment = document.createDocumentFragment();
        while (quote.firstChild) {
            fragment.appendChild(quote.firstChild);
        }

        parent.replaceChild(fragment, quote);

        if (!marker) {
            return;
        }

        const activeSelection = window.getSelection();
        if (!activeSelection || !marker.parentNode) {
            marker.remove();
            return;
        }

        const range = document.createRange();
        range.setStartBefore(marker);
        range.collapse(true);
        activeSelection.removeAllRanges();
        activeSelection.addRange(range);
        marker.remove();
    }

    private getSelectionOffsetInsideNode(selection: Selection, node: Node): number {
        if (!selection.rangeCount || !selection.isCollapsed) {
            return node.textContent?.length ?? 0;
        }

        const range = selection.getRangeAt(0).cloneRange();
        const probe = document.createRange();
        probe.selectNodeContents(node);
        probe.setEnd(range.endContainer, range.endOffset);
        return probe.toString().length;
    }

    private updateRichCommandStates(): void {
        if (this.editorMode !== 'rich') {
            this.resetRichCommandStates();
            return;
        }

        const editor = this.richEditor?.nativeElement;
        const selection = window.getSelection();
        if (!editor || !selection || !selection.rangeCount) {
            this.resetRichCommandStates();
            return;
        }

        const anchorNode = selection.anchorNode;
        if (!anchorNode || !editor.contains(anchorNode)) {
            this.resetRichCommandStates();
            return;
        }

        this.isBoldCommandActive = this.queryCommandStateSafe('bold');
        this.isItalicCommandActive = this.queryCommandStateSafe('italic');
        this.isUnorderedListCommandActive = this.queryCommandStateSafe('insertUnorderedList');
        this.isOrderedListCommandActive = this.queryCommandStateSafe('insertOrderedList');
        this.isLinkCommandActive = !!this.findAncestorTag(anchorNode, editor, 'A');
        this.isQuoteCommandActive = !!this.findAncestorTag(anchorNode, editor, 'BLOCKQUOTE');
        this.isSpoilerCommandActive = !!this.findActiveSpoilerNode(anchorNode, editor);
    }

    private queryCommandStateSafe(command: string): boolean {
        try {
            return !!document.queryCommandState(command);
        } catch {
            return false;
        }
    }

    private resetRichCommandStates(): void {
        this.isBoldCommandActive = false;
        this.isItalicCommandActive = false;
        this.isLinkCommandActive = false;
        this.isUnorderedListCommandActive = false;
        this.isOrderedListCommandActive = false;
        this.isQuoteCommandActive = false;
        this.isSpoilerCommandActive = false;
    }

    private placeCaretAtEndOfNode(node: Node): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richEditor?.nativeElement.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private selectNodeContents(node: Node): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richEditor?.nativeElement.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private placeCaretAtTextOffset(textNode: Text, offset: number): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        this.richEditor?.nativeElement.focus();
        const range = document.createRange();
        range.setStart(textNode, Math.max(0, Math.min(offset, textNode.length)));
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private focusActiveEditor(): void {
        if (this.editorMode === 'markdown') {
            this.markdownTextarea?.nativeElement.focus();
            return;
        }

        const editor = this.richEditor?.nativeElement;
        if (!editor) {
            return;
        }

        editor.focus();

        const selection = window.getSelection();
        if (!selection || selection.rangeCount > 0) {
            return;
        }

        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private refreshView(): void {
        this.ngZone.run(() => this.cdr.detectChanges());
    }
}
