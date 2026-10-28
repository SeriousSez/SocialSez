import { describe, expect, it } from 'vitest';
import { readStoryUploadBlob } from './story-upload.utils';

describe('story upload bytes', () => {
    const message = 'Select the file again.';

    it('copies the actual bytes into a new blob', async () => {
        const bytes = new Uint8Array([255, 216, 255, 224]);
        const file = { size: bytes.length, type: 'image/jpeg', arrayBuffer: async () => bytes.buffer } as File;
        const blob = await readStoryUploadBlob(file, message);
        expect(blob).not.toBe(file);
        expect(blob.size).toBe(bytes.length);
        expect(blob.type).toBe('image/jpeg');
        const content = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(blob);
        });
        expect(new Uint8Array(content)).toEqual(bytes);
    });

    it.each([0, 2])('rejects an empty or truncated read (%s bytes)', async length => {
        const file = { size: 4, arrayBuffer: async () => new ArrayBuffer(length) } as File;
        await expect(readStoryUploadBlob(file, message)).rejects.toThrow(message);
    });

    it('reports an unreadable native file using the localized message', async () => {
        const file = { arrayBuffer: async () => { throw new DOMException('Not readable'); } } as unknown as File;
        await expect(readStoryUploadBlob(file, message)).rejects.toThrow(message);
    });
});
