import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-settings-page',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './settings-page.component.html',
    styleUrl: './settings-page.component.scss'
})
export class SettingsPageComponent implements OnDestroy {
    readonly sectionOpenState: Record<'profile' | 'account' | 'session' | 'preferences' | 'logout', boolean> = {
        profile: true,
        account: false,
        session: false,
        preferences: false,
        logout: false
    };

    displayName = '';
    handle = '';
    bio = '';
    imageUrl = '';
    isPrivate = false;
    status = '';
    uploadingProfileImage = false;
    avatarModalOpen = false;
    avatarModalStep: 1 | 2 = 1;
    avatarCropZoom = 1;
    avatarCropOffsetX = 0;
    avatarCropOffsetY = 0;
    selectedAvatarFileName = '';

    @ViewChild('avatarFileInput') private avatarFileInputRef?: ElementRef<HTMLInputElement>;

    prefs = {
        compactFeed: false,
        darkMode: false,
    };

    private readonly prefsStorageKey = 'socialsez-web-prefs';
    private readonly avatarCropViewportSize = 280;
    private avatarCropSourceUrl = '';
    private avatarCropImageElement: HTMLImageElement | null = null;
    private avatarCropImageNaturalWidth = 0;
    private avatarCropImageNaturalHeight = 0;
    private avatarCropBaseWidth = this.avatarCropViewportSize;
    private avatarCropBaseHeight = this.avatarCropViewportSize;
    private draggingAvatarCrop = false;
    private avatarCropDragStartX = 0;
    private avatarCropDragStartY = 0;
    private avatarCropDragOriginOffsetX = 0;
    private avatarCropDragOriginOffsetY = 0;

    constructor(public readonly session: SessionService) {
        if (session.profile) {
            this.displayName = session.profile.displayName;
            this.handle = session.profile.handle;
            this.bio = session.profile.bio;
            this.imageUrl = session.profile.imageUrl ?? '';
            this.isPrivate = session.profile.isPrivate;
        }

        this.loadPrefs();
    }

    toggleSection(section: 'profile' | 'account' | 'session' | 'preferences' | 'logout'): void {
        this.sectionOpenState[section] = !this.sectionOpenState[section];
    }

    async saveProfile(): Promise<void> {
        try {
            this.handle = this.normalizeHandle(this.handle);
            await this.session.updateProfileAsync({
                displayName: this.displayName,
                handle: this.handle,
                bio: this.bio,
                imageUrl: this.imageUrl
            });
            this.status = 'Profile settings saved.';
        } catch (error) {
            this.status = this.extractApiMessage(error, 'Could not save profile settings.');
        }
    }

    async reloadProfile(): Promise<void> {
        try {
            await this.session.refreshMeAsync();
            if (this.session.profile) {
                this.displayName = this.session.profile.displayName;
                this.handle = this.session.profile.handle;
                this.bio = this.session.profile.bio;
                this.imageUrl = this.session.profile.imageUrl ?? '';
                this.isPrivate = this.session.profile.isPrivate;
            }
            this.status = 'Profile settings reloaded.';
        } catch {
            this.status = 'Could not reload profile settings.';
        }
    }

    async savePrivacy(): Promise<void> {
        try {
            await this.session.updateProfilePrivacyAsync(this.isPrivate);
            this.status = 'Privacy setting saved.';
        } catch {
            this.status = 'Could not save privacy setting.';
        }
    }

    onHandleInput(value: string): void {
        this.handle = this.normalizeHandle(value);
    }

    get handleChangeAvailableAtUtc(): Date | null {
        const raw = this.session.profile?.handleChangeAvailableAtUtc;
        if (!raw) {
            return null;
        }

        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    async refreshSession(): Promise<void> {
        try {
            await this.session.refreshSessionAsync();
            this.status = 'Session refreshed.';
        } catch {
            this.status = 'Could not refresh session.';
        }
    }

    async logout(): Promise<void> {
        await this.session.logoutAsync();
    }

    async onProfileImageSelected(event: Event): Promise<void> {
        if (this.uploadingProfileImage || this.avatarModalStep !== 1) {
            return;
        }

        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) {
            return;
        }

        try {
            await this.loadAvatarCropFileAsync(file);
            this.avatarModalStep = 2;
        } catch {
            this.status = 'Could not load image for cropping.';
        } finally {
            input.value = '';
        }
    }

    ngOnDestroy(): void {
        this.clearAvatarCropSource();
    }

    openAvatarModal(): void {
        if (this.uploadingProfileImage) {
            return;
        }

        this.avatarModalOpen = true;
        this.avatarModalStep = 1;
        this.resetAvatarCropState();
        this.status = '';
    }

    closeAvatarModal(force = false): void {
        if (this.uploadingProfileImage && !force) {
            return;
        }

        this.avatarModalOpen = false;
        this.avatarModalStep = 1;
        this.resetAvatarCropState();
    }

    backToAvatarSelectStep(): void {
        if (this.uploadingProfileImage) {
            return;
        }

        this.avatarModalStep = 1;
        this.avatarCropZoom = 1;
        this.avatarCropOffsetX = 0;
        this.avatarCropOffsetY = 0;
        this.clampAvatarCropOffsets();
    }

    triggerAvatarFilePicker(): void {
        this.avatarFileInputRef?.nativeElement.click();
    }

    get hasAvatarCropSelection(): boolean {
        return !!this.avatarCropImageElement;
    }

    get avatarCropPreviewUrl(): string {
        return this.avatarCropSourceUrl;
    }

    get avatarCropImageStyle(): Record<string, string> {
        return {
            width: `${this.avatarCropBaseWidth * this.avatarCropZoom}px`,
            height: `${this.avatarCropBaseHeight * this.avatarCropZoom}px`,
            left: `calc(50% + ${this.avatarCropOffsetX}px)`,
            top: `calc(50% + ${this.avatarCropOffsetY}px)`
        };
    }

    onAvatarCropZoomInput(value: string): void {
        const parsed = Number(value);
        this.avatarCropZoom = Number.isFinite(parsed) ? Math.min(3, Math.max(1, parsed)) : 1;
        this.clampAvatarCropOffsets();
    }

    onAvatarCropWheel(event: WheelEvent): void {
        if (!this.hasAvatarCropSelection || this.uploadingProfileImage) {
            return;
        }

        event.preventDefault();
        const direction = Math.sign(event.deltaY);
        if (!direction) {
            return;
        }

        const zoomStep = 0.05;
        const nextZoom = this.avatarCropZoom - (direction * zoomStep);
        this.avatarCropZoom = Math.min(3, Math.max(1, nextZoom));
        this.clampAvatarCropOffsets();
    }

    onAvatarCropPointerDown(event: PointerEvent): void {
        if (!this.hasAvatarCropSelection || this.uploadingProfileImage) {
            return;
        }

        this.draggingAvatarCrop = true;
        this.avatarCropDragStartX = event.clientX;
        this.avatarCropDragStartY = event.clientY;
        this.avatarCropDragOriginOffsetX = this.avatarCropOffsetX;
        this.avatarCropDragOriginOffsetY = this.avatarCropOffsetY;
    }

    @HostListener('document:pointermove', ['$event'])
    onAvatarCropPointerMove(event: PointerEvent): void {
        if (!this.draggingAvatarCrop) {
            return;
        }

        const deltaX = event.clientX - this.avatarCropDragStartX;
        const deltaY = event.clientY - this.avatarCropDragStartY;
        this.avatarCropOffsetX = this.avatarCropDragOriginOffsetX + deltaX;
        this.avatarCropOffsetY = this.avatarCropDragOriginOffsetY + deltaY;
        this.clampAvatarCropOffsets();
    }

    @HostListener('document:pointerup')
    onAvatarCropPointerUp(): void {
        this.draggingAvatarCrop = false;
    }

    async uploadCroppedAvatar(): Promise<void> {
        if (this.uploadingProfileImage || !this.avatarCropImageElement) {
            return;
        }

        this.uploadingProfileImage = true;
        this.status = '';

        try {
            const cropped = await this.buildCroppedAvatarFileAsync();
            this.imageUrl = await this.session.uploadImageAsync(cropped);
            this.status = 'Image uploaded. Save profile to apply it.';
            this.closeAvatarModal(true);
        } catch {
            this.status = 'Could not upload image.';
        } finally {
            this.uploadingProfileImage = false;
        }
    }

    removeProfileImage(): void {
        this.imageUrl = '';
        this.status = 'Image removed. Save profile to apply it.';
    }

    savePrefs(): void {
        localStorage.setItem(this.prefsStorageKey, JSON.stringify(this.prefs));
        this.applyThemePreference();
        this.status = 'Preferences saved.';
    }

    private loadPrefs(): void {
        const stored = localStorage.getItem(this.prefsStorageKey);
        if (!stored) {
            return;
        }

        try {
            const parsed = JSON.parse(stored) as Partial<typeof this.prefs>;
            this.prefs = {
                compactFeed: parsed.compactFeed ?? this.prefs.compactFeed,
                darkMode: parsed.darkMode ?? this.prefs.darkMode,
            };
        } catch {
            this.prefs = { compactFeed: false, darkMode: false };
        }

        this.applyThemePreference();
    }

    private applyThemePreference(): void {
        document.documentElement.classList.toggle('theme-dark', !!this.prefs.darkMode);
    }

    private normalizeHandle(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-');
    }

    private extractApiMessage(error: unknown, fallback: string): string {
        const maybeMessage = (error as { error?: { message?: string } })?.error?.message;
        if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
            return maybeMessage;
        }

        return fallback;
    }

    private async loadAvatarCropFileAsync(file: File): Promise<void> {
        this.clearAvatarCropSource();
        this.selectedAvatarFileName = file.name;

        const objectUrl = URL.createObjectURL(file);
        const imageElement = new Image();

        await new Promise<void>((resolve, reject) => {
            imageElement.onload = () => resolve();
            imageElement.onerror = () => reject(new Error('Could not load image'));
            imageElement.src = objectUrl;
        });

        this.avatarCropSourceUrl = objectUrl;
        this.avatarCropImageElement = imageElement;
        this.avatarCropImageNaturalWidth = imageElement.naturalWidth;
        this.avatarCropImageNaturalHeight = imageElement.naturalHeight;
        this.avatarCropZoom = 1;
        this.avatarCropOffsetX = 0;
        this.avatarCropOffsetY = 0;
        this.updateAvatarCropBaseSize();
    }

    private updateAvatarCropBaseSize(): void {
        if (!this.avatarCropImageNaturalWidth || !this.avatarCropImageNaturalHeight) {
            this.avatarCropBaseWidth = this.avatarCropViewportSize;
            this.avatarCropBaseHeight = this.avatarCropViewportSize;
            return;
        }

        const ratio = this.avatarCropImageNaturalWidth / this.avatarCropImageNaturalHeight;
        if (ratio >= 1) {
            this.avatarCropBaseHeight = this.avatarCropViewportSize;
            this.avatarCropBaseWidth = this.avatarCropViewportSize * ratio;
        } else {
            this.avatarCropBaseWidth = this.avatarCropViewportSize;
            this.avatarCropBaseHeight = this.avatarCropViewportSize / ratio;
        }

        this.clampAvatarCropOffsets();
    }

    private clampAvatarCropOffsets(): void {
        const scaledWidth = this.avatarCropBaseWidth * this.avatarCropZoom;
        const scaledHeight = this.avatarCropBaseHeight * this.avatarCropZoom;
        const maxOffsetX = Math.max(0, (scaledWidth - this.avatarCropViewportSize) / 2);
        const maxOffsetY = Math.max(0, (scaledHeight - this.avatarCropViewportSize) / 2);

        this.avatarCropOffsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, this.avatarCropOffsetX));
        this.avatarCropOffsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, this.avatarCropOffsetY));
    }

    private async buildCroppedAvatarFileAsync(): Promise<File> {
        if (!this.avatarCropImageElement) {
            throw new Error('No image selected');
        }

        const outputSize = 512;
        const viewportSize = this.avatarCropViewportSize;
        const scale = outputSize / viewportSize;
        const scaledWidth = this.avatarCropBaseWidth * this.avatarCropZoom * scale;
        const scaledHeight = this.avatarCropBaseHeight * this.avatarCropZoom * scale;
        const drawX = ((outputSize - scaledWidth) / 2) + (this.avatarCropOffsetX * scale);
        const drawY = ((outputSize - scaledHeight) / 2) + (this.avatarCropOffsetY * scale);

        const canvas = document.createElement('canvas');
        canvas.width = outputSize;
        canvas.height = outputSize;

        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Could not create canvas context');
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, outputSize, outputSize);
        context.drawImage(this.avatarCropImageElement, drawX, drawY, scaledWidth, scaledHeight);

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error('Could not export cropped image'));
                }
            }, 'image/png');
        });

        return new File([blob], `avatar-${Date.now()}.png`, { type: 'image/png' });
    }

    private resetAvatarCropState(): void {
        this.clearAvatarCropSource();
        this.selectedAvatarFileName = '';
        this.avatarCropZoom = 1;
        this.avatarCropOffsetX = 0;
        this.avatarCropOffsetY = 0;
        this.draggingAvatarCrop = false;
        if (this.avatarFileInputRef?.nativeElement) {
            this.avatarFileInputRef.nativeElement.value = '';
        }
    }

    private clearAvatarCropSource(): void {
        if (this.avatarCropSourceUrl) {
            URL.revokeObjectURL(this.avatarCropSourceUrl);
        }

        this.avatarCropSourceUrl = '';
        this.avatarCropImageElement = null;
        this.avatarCropImageNaturalWidth = 0;
        this.avatarCropImageNaturalHeight = 0;
        this.avatarCropBaseWidth = this.avatarCropViewportSize;
        this.avatarCropBaseHeight = this.avatarCropViewportSize;
    }
}