function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeUrl(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('#')) {
        return escapeHtml(trimmed);
    }

    const lower = trimmed.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
        return escapeHtml(trimmed);
    }

    return null;
}

function formatInline(text: string): string {
    let formatted = escapeHtml(text);

    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    formatted = formatted.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (full, label: string, url: string) => {
        const safeUrl = sanitizeUrl(url);
        if (!safeUrl) {
            return full;
        }

        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    return formatted;
}

export function renderMarkdownToHtml(markdown: string | null | undefined): string {
    const source = (markdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!source.trim()) {
        return '<p></p>';
    }

    const lines = source.split('\n');
    const html: string[] = [];

    let paragraph: string[] = [];
    let codeBlock: string[] = [];
    let inCodeBlock = false;
    let listType: 'ul' | 'ol' | null = null;

    const flushParagraph = () => {
        if (!paragraph.length) {
            return;
        }

        const paragraphHtml = paragraph.map(line => formatInline(line)).join('<br />');
        html.push(`<p>${paragraphHtml}</p>`);
        paragraph = [];
    };

    const closeList = () => {
        if (!listType) {
            return;
        }

        html.push(`</${listType}>`);
        listType = null;
    };

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            flushParagraph();
            closeList();

            if (inCodeBlock) {
                html.push(`<pre><code>${escapeHtml(codeBlock.join('\n'))}</code></pre>`);
                codeBlock = [];
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
            }

            continue;
        }

        if (inCodeBlock) {
            codeBlock.push(line);
            continue;
        }

        if (!trimmed) {
            flushParagraph();
            closeList();
            continue;
        }

        const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
        if (headingMatch) {
            flushParagraph();
            closeList();
            const level = headingMatch[1].length;
            html.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
            continue;
        }

        const blockQuoteMatch = /^>\s+(.+)$/.exec(trimmed);
        if (blockQuoteMatch) {
            flushParagraph();
            closeList();
            html.push(`<blockquote>${formatInline(blockQuoteMatch[1])}</blockquote>`);
            continue;
        }

        const unorderedListMatch = /^[-*]\s+(.+)$/.exec(trimmed);
        if (unorderedListMatch) {
            flushParagraph();
            if (listType !== 'ul') {
                closeList();
                html.push('<ul>');
                listType = 'ul';
            }

            html.push(`<li>${formatInline(unorderedListMatch[1])}</li>`);
            continue;
        }

        const orderedListMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
        if (orderedListMatch) {
            flushParagraph();
            if (listType !== 'ol') {
                closeList();
                html.push('<ol>');
                listType = 'ol';
            }

            html.push(`<li>${formatInline(orderedListMatch[1])}</li>`);
            continue;
        }

        closeList();
        paragraph.push(trimmed);
    }

    if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeBlock.join('\n'))}</code></pre>`);
    }

    flushParagraph();
    closeList();
    return html.join('');
}