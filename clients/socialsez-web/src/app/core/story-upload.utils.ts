/** Materialize native picker files before multipart serialization (including Safari). */
export async function readStoryUploadBlob(file: File, unreadableMessage: string): Promise<Blob> {
    try {
        const bytes = await file.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength !== file.size) {
            throw new Error(unreadableMessage);
        }

        return new Blob([bytes], { type: file.type || 'application/octet-stream' });
    } catch {
        throw new Error(unreadableMessage);
    }
}
