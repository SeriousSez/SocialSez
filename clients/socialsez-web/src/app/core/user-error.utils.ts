export function extractApiErrorMessage(error: unknown): string | null {
    const apiMessage = (error as { error?: { message?: string } })?.error?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
        return apiMessage.trim();
    }

    const directMessage = (error as { message?: string })?.message;
    if (typeof directMessage === 'string' && directMessage.trim()) {
        return directMessage.trim();
    }

    return null;
}

export function normalizeUserMessage(message: string): string {
    const normalized = message.trim().replace(/\s+/g, ' ');
    if (!normalized) {
        return 'Something went wrong.';
    }

    const withLeadingCapital = normalized[0].toUpperCase() + normalized.slice(1);
    return /[.!?]$/.test(withLeadingCapital)
        ? withLeadingCapital
        : `${withLeadingCapital}.`;
}

export function actionError(action: string): string {
    return normalizeUserMessage(`Could not ${action}. Please try again.`);
}

export function toUserErrorMessage(error: unknown, fallback: string): string {
    return normalizeUserMessage(extractApiErrorMessage(error) ?? fallback);
}
