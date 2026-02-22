import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-settings-page',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './settings-page.component.html',
    styleUrl: './settings-page.component.scss'
})
export class SettingsPageComponent {
    displayName = '';
    bio = '';
    imageUrl = '';
    isPrivate = false;
    status = '';
    uploadingProfileImage = false;

    prefs = {
        compactFeed: false,
        showDebugTimes: true
    };

    private readonly prefsStorageKey = 'socialsez-web-prefs';

    constructor(public readonly session: SessionService) {
        if (session.profile) {
            this.displayName = session.profile.displayName;
            this.bio = session.profile.bio;
            this.imageUrl = session.profile.imageUrl ?? '';
            this.isPrivate = session.profile.isPrivate;
        }

        this.loadPrefs();
    }

    async saveProfile(): Promise<void> {
        try {
            await this.session.updateProfileAsync({
                displayName: this.displayName,
                bio: this.bio,
                imageUrl: this.imageUrl
            });
            this.status = 'Profile settings saved.';
        } catch {
            this.status = 'Could not save profile settings.';
        }
    }

    async reloadProfile(): Promise<void> {
        try {
            await this.session.refreshMeAsync();
            if (this.session.profile) {
                this.displayName = this.session.profile.displayName;
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
        if (this.uploadingProfileImage) {
            return;
        }

        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) {
            return;
        }

        this.uploadingProfileImage = true;
        this.status = '';

        try {
            this.imageUrl = await this.session.uploadImageAsync(file);
            this.status = 'Image uploaded. Save profile to apply it.';
        } catch {
            this.status = 'Could not upload image.';
        } finally {
            this.uploadingProfileImage = false;
            input.value = '';
        }
    }

    removeProfileImage(): void {
        this.imageUrl = '';
        this.status = 'Image removed. Save profile to apply it.';
    }

    savePrefs(): void {
        localStorage.setItem(this.prefsStorageKey, JSON.stringify(this.prefs));
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
                showDebugTimes: parsed.showDebugTimes ?? this.prefs.showDebugTimes
            };
        } catch {
            this.prefs = { compactFeed: false, showDebugTimes: true };
        }
    }
}