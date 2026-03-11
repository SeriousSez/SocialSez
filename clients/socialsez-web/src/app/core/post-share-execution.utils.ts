export interface PostShareExecutionState {
    sharingPostId: string | null;
    errorMessage: string;
}

export async function executePostShareAction(
    state: PostShareExecutionState,
    postId: string,
    action: () => Promise<void>,
    errorMessage: string,
    ...busyFlags: boolean[]
): Promise<boolean> {
    if (state.sharingPostId || busyFlags.some(Boolean)) {
        return false;
    }

    state.sharingPostId = postId;
    state.errorMessage = '';

    try {
        await action();
        return true;
    } catch {
        state.errorMessage = errorMessage;
        return false;
    } finally {
        state.sharingPostId = null;
    }
}

export async function executePostShareToChat(
    state: PostShareExecutionState,
    postId: string,
    recipientIds: readonly string[],
    groupChatIds: readonly string[] | undefined,
    action: () => Promise<void>,
    errorMessage: string,
    ...busyFlags: boolean[]
): Promise<boolean> {
    if (!recipientIds.length && (!groupChatIds || !groupChatIds.length)) {
        return false;
    }

    return executePostShareAction(
        state,
        postId,
        action,
        errorMessage,
        ...busyFlags
    );
}

export async function executePostShareToFeedAndReload(
    state: PostShareExecutionState,
    postId: string,
    shareAction: () => Promise<void>,
    reloadAction: () => Promise<void>,
    errorMessage: string,
    ...busyFlags: boolean[]
): Promise<boolean> {
    return executePostShareAction(
        state,
        postId,
        async () => {
            await shareAction();
            await reloadAction();
        },
        errorMessage,
        ...busyFlags
    );
}
