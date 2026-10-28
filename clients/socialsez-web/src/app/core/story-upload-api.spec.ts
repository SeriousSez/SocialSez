import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialSezApiService } from './socialsez-api.service';

describe('story multipart upload', () => {
    let api: SocialSezApiService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [
            provideHttpClient(), provideHttpClientTesting(),
            { provide: TranslateService, useValue: { instant: () => 'Select the file again.' } }
        ] });
        api = TestBed.inject(SocialSezApiService);
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => http.verify());

    it('sends a materialized file with its filename and story options', async () => {
        const file = { name: 'IMG_7549.jpeg', type: 'image/jpeg', size: 4,
            arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([255, 216, 255, 224]).buffer) } as unknown as File;
        const result = firstValueFrom(api.createStory(file, ' Caption ', true, undefined, true));
        await vi.waitFor(() => {
            const request = http.expectOne(req => req.url.endsWith('/stories'));
            const form = request.request.body as FormData;
            const media = form.get('media') as File;
            expect(media).not.toBe(file);
            expect(media.name).toBe('IMG_7549.jpeg');
            expect(media.type).toBe('image/jpeg');
            expect(media.size).toBe(4);
            expect(form.get('caption')).toBe('Caption');
            expect(form.get('isSensitive')).toBe('true');
            expect(form.get('saveAsDraft')).toBe('true');
            request.flush({ id: 'story' });
        });
        await expect(result).resolves.toEqual({ id: 'story' });
        expect(file.arrayBuffer).toHaveBeenCalledOnce();
    });

    it('does not send an HTTP request when the file bytes are empty', async () => {
        const file = { size: 10, arrayBuffer: async () => new ArrayBuffer(0) } as File;
        await expect(firstValueFrom(api.createStory(file))).rejects.toThrow('Select the file again.');
        http.expectNone(req => req.url.endsWith('/stories'));
    });
});
