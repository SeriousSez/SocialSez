import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthSessionDto, ProfileDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { RichTextEditorComponent } from '../../shared/rich-text-editor/rich-text-editor.component';
import { actionError, toUserErrorMessage } from '../../core/user-error.utils';

type AudiencePreference = 'everyone' | 'following' | 'nobody';
type SensitiveContentLevel = 'standard' | 'limited' | 'strict';

interface DiscoveryPrivacyPrefs {
    commentsAudience: AudiencePreference;
    mentionsAudience: AudiencePreference;
    messagesAudience: AudiencePreference;
    storyRepliesAudience: AudiencePreference;
    showInSearchSuggestions: boolean;
    allowProfileIndexing: boolean;
    showActivityStatus: boolean;
}

interface NotificationPrefs {
    likes: boolean;
    comments: boolean;
    follows: boolean;
    mentions: boolean;
    messages: boolean;
    marketing: boolean;
    product: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
}

interface SafetyPrefs {
    mutedKeywords: string[];
    sensitiveContentLevel: SensitiveContentLevel;
    hideSensitiveMedia: boolean;
    mutedHandles: string[];
}

interface AccessibilityPrefs {
    reducedMotion: boolean;
    largerText: boolean;
    highContrast: boolean;
    language: string;
    region: string;
}

interface DeviceSessionEntry {
    id: string;
    label: string;
    createdAtUtc: string;
    expiresAtUtc: string;
    lastActiveUtc: string;
    current: boolean;
    revoked: boolean;
}

type SettingsSectionKey = 'profile' | 'account' | 'privacy' | 'session' | 'preferences' | 'notifications' | 'safety' | 'security' | 'data' | 'blocked' | 'logout';
type AccountActionKind = 'deactivate' | 'delete';

@Component({
    selector: 'app-settings-page',
    standalone: true,
    imports: [CommonModule, FormsModule, ConfirmModalComponent, RichTextEditorComponent],
    templateUrl: './settings-page.component.html',
    styleUrl: './settings-page.component.scss'
})
export class SettingsPageComponent implements OnDestroy {
    readonly sectionOpenState: Record<SettingsSectionKey, boolean> = {
        profile: true,
        account: false,
        privacy: false,
        session: false,
        preferences: false,
        notifications: false,
        safety: false,
        security: false,
        data: false,
        blocked: false,
        logout: false
    };

    displayName = '';
    handle = '';
    bio = '';
    imageUrl = '';
    isPrivate = false;
    private initialPrivacy = false;
    savingPrivacy = false;
    blockedProfiles: ProfileDto[] = [];
    loadingBlockedProfiles = false;
    unblockingProfileId: string | null = null;
    private blockedProfilesLoaded = false;
    uploadingProfileImage = false;
    avatarModalOpen = false;
    avatarModalStep: 1 | 2 = 1;
    avatarCropZoom = 1;
    avatarCropOffsetX = 0;
    avatarCropOffsetY = 0;
    selectedAvatarFileName = '';
    privacyPrefsSaving = false;
    notificationsSaving = false;
    safetySaving = false;
    accessibilitySaving = false;
    securitySaving = false;
    dataActionWorking = false;
    addMutedKeywordValue = '';
    addMutedHandleValue = '';
    mutedHandleSuggestions: ProfileDto[] = [];
    mutedHandleSuggestionsOpen = false;
    mutedHandleSuggestionsLoading = false;
    deactivateConfirmValue = '';
    deleteConfirmValue = '';
    pendingAccountAction: AccountActionKind | null = null;
    revokeSessionId: string | null = null;
    deviceSessions: DeviceSessionEntry[] = [];
    private mutedHandleSearchDebounceId: number | null = null;
    private mutedHandleSearchToken = 0;

    readonly audienceOptions: ReadonlyArray<{ value: AudiencePreference; label: string }> = [
        { value: 'everyone', label: 'Everyone' },
        { value: 'following', label: 'People you follow' },
        { value: 'nobody', label: 'Nobody' }
    ];

    readonly sensitiveContentOptions: ReadonlyArray<{ value: SensitiveContentLevel; label: string }> = [
        { value: 'standard', label: 'Standard' },
        { value: 'limited', label: 'Limited' },
        { value: 'strict', label: 'Strict' }
    ];

    readonly languageOptions: ReadonlyArray<{ value: string; label: string }> = [
        { value: 'system', label: 'System default' },
        { value: 'en-US', label: 'English (US)' },
        { value: 'en-GB', label: 'English (UK)' }
    ];

    readonly regionOptions: ReadonlyArray<{ value: string; label: string }> = [
        { value: 'system', label: 'System default' },
        { value: 'US', label: 'United States' },
        { value: 'GB', label: 'United Kingdom' },
        { value: 'CA', label: 'Canada' }
    ];

    @ViewChild('avatarFileInput') private avatarFileInputRef?: ElementRef<HTMLInputElement>;

    prefs = {
        compactFeed: false,
        useSystemTheme: true,
        darkMode: false,
        reducedMotion: false,
        largerText: false,
        highContrast: false,
        language: 'system',
        region: 'system'
    };

    discoveryPrivacyPrefs: DiscoveryPrivacyPrefs = {
        commentsAudience: 'everyone',
        mentionsAudience: 'everyone',
        messagesAudience: 'everyone',
        storyRepliesAudience: 'everyone',
        showInSearchSuggestions: true,
        allowProfileIndexing: true,
        showActivityStatus: true
    };

    notificationPrefs: NotificationPrefs = {
        likes: true,
        comments: true,
        follows: true,
        mentions: true,
        messages: true,
        marketing: false,
        product: true,
        quietHoursEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00'
    };

    safetyPrefs: SafetyPrefs = {
        mutedKeywords: [],
        sensitiveContentLevel: 'standard',
        hideSensitiveMedia: false,
        mutedHandles: []
    };

    accessibilityPrefs: AccessibilityPrefs = {
        reducedMotion: false,
        largerText: false,
        highContrast: false,
        language: 'system',
        region: 'system'
    };

    sectionSavedAt: Partial<Record<'privacy' | 'notifications' | 'safety' | 'accessibility' | 'security' | 'data', string>> = {};

    private initialDiscoveryPrivacyPrefs: DiscoveryPrivacyPrefs = { ...this.discoveryPrivacyPrefs };
    private initialNotificationPrefs: NotificationPrefs = { ...this.notificationPrefs };
    private initialSafetyPrefs: SafetyPrefs = { ...this.safetyPrefs, mutedKeywords: [], mutedHandles: [] };
    private initialAccessibilityPrefs: AccessibilityPrefs = { ...this.accessibilityPrefs };

    private readonly prefsStorageKey = 'socialsez-web-prefs';
    private readonly discoveryPrivacyStorageKey = 'socialsez-web-privacy-prefs';
    private readonly notificationStorageKey = 'socialsez-web-notification-prefs';
    private readonly safetyStorageKey = 'socialsez-web-safety-prefs';
    private readonly sectionSavedAtStorageKey = 'socialsez-web-settings-last-saved';
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
            this.initialPrivacy = session.profile.isPrivate;
        }

        this.loadPrefs();
        this.loadDiscoveryPrivacyPrefs();
        this.loadNotificationPrefs();
        this.loadSafetyPrefs();
        this.loadSectionSavedAt();
        void this.loadDeviceSessionsAsync();
    }

    toggleSection(section: SettingsSectionKey): void {
        for (const key of Object.keys(this.sectionOpenState) as SettingsSectionKey[]) {
            this.sectionOpenState[key] = key === section;
        }

        this.scrollSectionIntoView(section);

        if (section === 'blocked' && this.sectionOpenState.blocked) {
            void this.loadBlockedProfilesAsync();
        }

        if (section === 'security' && this.sectionOpenState.security) {
            void this.loadDeviceSessionsAsync(true);
        }
    }

    private scrollSectionIntoView(section: SettingsSectionKey): void {
        window.setTimeout(() => {
            const sectionElement = document.getElementById(`settings-section-${section}`);
            sectionElement?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        }, 0);
    }

    async loadBlockedProfilesAsync(force = false): Promise<void> {
        if (this.loadingBlockedProfiles || (!force && this.blockedProfilesLoaded)) {
            return;
        }

        this.loadingBlockedProfiles = true;
        try {
            this.blockedProfiles = await this.session.loadBlockedProfilesAsync(250);
            this.blockedProfilesLoaded = true;
        } catch {
            this.session.message = actionError('load blocked users');
        } finally {
            this.loadingBlockedProfiles = false;
        }
    }

    async unblock(profile: ProfileDto): Promise<void> {
        if (this.unblockingProfileId || !profile?.id) {
            return;
        }

        this.unblockingProfileId = profile.id;

        try {
            await this.session.unblockProfileAsync(profile.id);
            this.blockedProfiles = this.blockedProfiles.filter(item => item.id !== profile.id);
            this.session.message = `Unblocked @${profile.handle}.`;
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError(`unblock @${profile.handle}`));
        } finally {
            this.unblockingProfileId = null;
        }
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
            this.session.message = 'Profile settings saved.';
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('save profile settings'));
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
                this.initialPrivacy = this.session.profile.isPrivate;
            }
            this.session.message = 'Profile settings reloaded.';
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('reload profile settings'));
        }
    }

    get hasPrivacyChanges(): boolean {
        return this.isPrivate !== this.initialPrivacy;
    }

    get hasDiscoveryPrivacyChanges(): boolean {
        return this.areObjectsDifferent(this.initialDiscoveryPrivacyPrefs, this.discoveryPrivacyPrefs);
    }

    get hasNotificationChanges(): boolean {
        return this.areObjectsDifferent(this.initialNotificationPrefs, this.notificationPrefs);
    }

    get hasSafetyChanges(): boolean {
        return this.areObjectsDifferent(this.initialSafetyPrefs, this.safetyPrefs);
    }

    get hasAccessibilityChanges(): boolean {
        return this.areObjectsDifferent(this.initialAccessibilityPrefs, this.accessibilityPrefs);
    }

    get hasAnyUnsavedChanges(): boolean {
        return this.hasPrivacyChanges
            || this.hasDiscoveryPrivacyChanges
            || this.hasNotificationChanges
            || this.hasSafetyChanges
            || this.hasAccessibilityChanges;
    }

    resetPrivacyChanges(): void {
        this.isPrivate = this.initialPrivacy;
    }

    resetAllUnsavedChanges(): void {
        this.resetPrivacyChanges();
        this.discoveryPrivacyPrefs = { ...this.initialDiscoveryPrivacyPrefs };
        this.notificationPrefs = { ...this.initialNotificationPrefs };
        this.safetyPrefs = {
            ...this.initialSafetyPrefs,
            mutedKeywords: [...this.initialSafetyPrefs.mutedKeywords],
            mutedHandles: [...this.initialSafetyPrefs.mutedHandles]
        };
        this.accessibilityPrefs = { ...this.initialAccessibilityPrefs };
        this.syncPrefsFromAccessibility();
    }

    async savePrivacy(): Promise<void> {
        if (this.savingPrivacy || !this.hasPrivacyChanges) {
            return;
        }

        this.savingPrivacy = true;
        try {
            await this.session.updateProfilePrivacyAsync(this.isPrivate);
            this.initialPrivacy = this.isPrivate;
            this.session.message = 'Privacy setting saved.';
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('save privacy setting'));
        } finally {
            this.savingPrivacy = false;
        }
    }

    onUseSystemThemeChanged(): void {
        if (this.prefs.useSystemTheme) {
            this.prefs.darkMode = this.prefersSystemDarkMode();
        }

        this.savePrefs();
    }

    saveDiscoveryPrivacyPrefs(): void {
        if (this.privacyPrefsSaving || !this.hasDiscoveryPrivacyChanges) {
            return;
        }

        this.privacyPrefsSaving = true;
        try {
            localStorage.setItem(this.discoveryPrivacyStorageKey, JSON.stringify(this.discoveryPrivacyPrefs));
            this.initialDiscoveryPrivacyPrefs = { ...this.discoveryPrivacyPrefs };
            this.markSectionSaved('privacy');
            this.session.message = 'Discovery and audience privacy preferences saved.';
        } finally {
            this.privacyPrefsSaving = false;
        }
    }

    resetDiscoveryPrivacyPrefs(): void {
        this.discoveryPrivacyPrefs = { ...this.initialDiscoveryPrivacyPrefs };
    }

    saveNotificationPrefs(): void {
        if (this.notificationsSaving || !this.hasNotificationChanges) {
            return;
        }

        this.notificationsSaving = true;
        try {
            localStorage.setItem(this.notificationStorageKey, JSON.stringify(this.notificationPrefs));
            this.initialNotificationPrefs = { ...this.notificationPrefs };
            this.markSectionSaved('notifications');
            this.session.message = 'Notification preferences saved.';
        } finally {
            this.notificationsSaving = false;
        }
    }

    resetNotificationPrefs(): void {
        this.notificationPrefs = { ...this.initialNotificationPrefs };
    }

    addMutedKeyword(): void {
        const normalized = this.addMutedKeywordValue.trim().toLowerCase();
        if (!normalized || this.safetyPrefs.mutedKeywords.includes(normalized)) {
            return;
        }

        this.safetyPrefs.mutedKeywords = [...this.safetyPrefs.mutedKeywords, normalized];
        this.addMutedKeywordValue = '';
    }

    removeMutedKeyword(keyword: string): void {
        this.safetyPrefs.mutedKeywords = this.safetyPrefs.mutedKeywords.filter(item => item !== keyword);
    }

    addMutedHandle(handleInput?: string): void {
        const normalized = this.normalizeHandle((handleInput ?? this.addMutedHandleValue).replace(/^@/, ''));
        if (!normalized || this.safetyPrefs.mutedHandles.includes(normalized)) {
            return;
        }

        this.safetyPrefs.mutedHandles = [...this.safetyPrefs.mutedHandles, normalized];
        this.addMutedHandleValue = '';
        this.closeMutedHandleSuggestions();
    }

    removeMutedHandle(handle: string): void {
        this.safetyPrefs.mutedHandles = this.safetyPrefs.mutedHandles.filter(item => item !== handle);
    }

    onMutedHandleInputChanged(value: string): void {
        this.addMutedHandleValue = value;

        const query = this.extractMutedHandleQuery(value);
        if (!query) {
            this.closeMutedHandleSuggestions();
            return;
        }

        this.searchMutedHandleSuggestions(query);
    }

    onMutedHandleInputFocus(): void {
        const query = this.extractMutedHandleQuery(this.addMutedHandleValue);
        if (!query) {
            return;
        }

        this.searchMutedHandleSuggestions(query);
    }

    onMutedHandleInputBlur(): void {
        window.setTimeout(() => {
            this.closeMutedHandleSuggestions();
        }, 120);
    }

    onMutedHandleInputEnter(event: Event): void {
        event.preventDefault();
        this.addMutedHandle();
    }

    selectMutedHandleSuggestion(profile: ProfileDto): void {
        this.addMutedHandle(`@${profile.handle}`);
    }

    saveSafetyPrefs(): void {
        if (this.safetySaving || !this.hasSafetyChanges) {
            return;
        }

        this.safetySaving = true;
        try {
            localStorage.setItem(this.safetyStorageKey, JSON.stringify(this.safetyPrefs));
            this.initialSafetyPrefs = {
                ...this.safetyPrefs,
                mutedKeywords: [...this.safetyPrefs.mutedKeywords],
                mutedHandles: [...this.safetyPrefs.mutedHandles]
            };
            this.markSectionSaved('safety');
            this.session.message = 'Safety preferences saved.';
        } finally {
            this.safetySaving = false;
        }
    }

    resetSafetyPrefs(): void {
        this.safetyPrefs = {
            ...this.initialSafetyPrefs,
            mutedKeywords: [...this.initialSafetyPrefs.mutedKeywords],
            mutedHandles: [...this.initialSafetyPrefs.mutedHandles]
        };
        this.addMutedKeywordValue = '';
        this.addMutedHandleValue = '';
    }

    saveAccessibilityPrefs(): void {
        if (this.accessibilitySaving || !this.hasAccessibilityChanges) {
            return;
        }

        this.accessibilitySaving = true;
        try {
            this.syncPrefsFromAccessibility();
            localStorage.setItem(this.prefsStorageKey, JSON.stringify(this.prefs));
            this.applyThemePreference();
            this.applyAccessibilityPreferences();
            this.initialAccessibilityPrefs = { ...this.accessibilityPrefs };
            this.markSectionSaved('accessibility');
            this.session.message = 'Accessibility preferences saved.';
        } finally {
            this.accessibilitySaving = false;
        }
    }

    resetAccessibilityPrefs(): void {
        this.accessibilityPrefs = { ...this.initialAccessibilityPrefs };
        this.syncPrefsFromAccessibility();
    }

    async revokeDeviceSession(sessionId: string): Promise<void> {
        if (this.securitySaving || this.revokeSessionId) {
            return;
        }

        this.revokeSessionId = sessionId;
        this.securitySaving = true;
        try {
            await this.session.revokeAuthSessionByIdAsync(sessionId);
            await this.loadDeviceSessionsAsync(true);
            this.markSectionSaved('security');
            this.session.message = 'Session revoked.';
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('revoke session'));
        } finally {
            this.revokeSessionId = null;
            this.securitySaving = false;
        }
    }

    async logoutOtherSessions(): Promise<void> {
        if (this.securitySaving) {
            return;
        }

        this.securitySaving = true;
        try {
            const revokedCount = await this.session.revokeOtherAuthSessionsAsync();
            await this.loadDeviceSessionsAsync(true);
            this.markSectionSaved('security');
            this.session.message = revokedCount > 0
                ? `Logged out ${revokedCount} other session${revokedCount === 1 ? '' : 's'}.`
                : 'No other active sessions to revoke.';
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('log out other sessions'));
        } finally {
            this.securitySaving = false;
        }
    }

    async exportMyData(): Promise<void> {
        if (this.dataActionWorking || !this.session.profile) {
            return;
        }

        this.dataActionWorking = true;
        try {
            const payload = {
                exportedAtUtc: new Date().toISOString(),
                profile: this.session.profile,
                settings: {
                    isPrivate: this.isPrivate,
                    discoveryPrivacy: this.discoveryPrivacyPrefs,
                    notifications: this.notificationPrefs,
                    safety: this.safetyPrefs,
                    preferences: this.prefs,
                    accessibility: this.accessibilityPrefs
                },
                notices: this.session.noticeHistory
            };

            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `socialsez-data-export-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);

            this.markSectionSaved('data');
            this.session.message = 'Data export downloaded.';
        } finally {
            this.dataActionWorking = false;
        }
    }

    async requestDeactivation(): Promise<void> {
        if (this.dataActionWorking) {
            return;
        }

        if (this.deactivateConfirmValue.trim().toUpperCase() !== 'DEACTIVATE') {
            this.session.message = 'Type DEACTIVATE to confirm account deactivation request.';
            return;
        }

        this.pendingAccountAction = 'deactivate';
    }

    async requestDeleteAccount(): Promise<void> {
        if (this.dataActionWorking) {
            return;
        }

        if (this.deleteConfirmValue.trim().toUpperCase() !== 'DELETE') {
            this.session.message = 'Type DELETE to confirm account deletion request.';
            return;
        }

        this.pendingAccountAction = 'delete';
    }

    cancelPendingAccountAction(): void {
        if (this.dataActionWorking) {
            return;
        }

        this.pendingAccountAction = null;
    }

    async confirmPendingAccountAction(): Promise<void> {
        if (!this.pendingAccountAction || this.dataActionWorking) {
            return;
        }

        const action = this.pendingAccountAction;
        this.dataActionWorking = true;
        try {
            if (action === 'deactivate') {
                await this.session.deactivateMyAccountAsync();
                this.markSectionSaved('data');
                this.session.message = 'Account deactivated and sessions revoked.';
                this.deactivateConfirmValue = '';
                await this.session.logoutAsync();
                return;
            }

            await this.session.deleteMyAccountAsync();
            this.markSectionSaved('data');
            this.session.message = 'Account deleted.';
            this.deleteConfirmValue = '';
            await this.session.logoutAsync();
        } catch (error) {
            const actionName = action === 'deactivate' ? 'deactivate account' : 'delete account';
            this.session.message = toUserErrorMessage(error, actionError(actionName));
        } finally {
            this.dataActionWorking = false;
            this.pendingAccountAction = null;
        }
    }

    get accountActionModalTitle(): string {
        return this.pendingAccountAction === 'deactivate' ? 'Deactivate account' : 'Delete account';
    }

    get accountActionModalMessage(): string {
        return this.pendingAccountAction === 'deactivate'
            ? 'Deactivate your account now? This signs you out immediately and revokes your active sessions.'
            : 'Delete your account permanently? This cannot be undone and signs you out immediately.';
    }

    get accountActionModalConfirmText(): string {
        return this.pendingAccountAction === 'deactivate' ? 'Deactivate' : 'Delete';
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
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('refresh your session'));
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
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('load image for cropping'));
        } finally {
            input.value = '';
        }
    }

    ngOnDestroy(): void {
        this.closeMutedHandleSuggestions();
        this.clearAvatarCropSource();
    }

    openAvatarModal(): void {
        if (this.uploadingProfileImage) {
            return;
        }

        this.avatarModalOpen = true;
        this.avatarModalStep = 1;
        this.resetAvatarCropState();
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

        try {
            const cropped = await this.buildCroppedAvatarFileAsync();
            const uploadedUrl = await this.session.uploadImageAsync(cropped);
            this.imageUrl = uploadedUrl;

            await this.session.updateProfileAsync({
                displayName: this.displayName,
                handle: this.handle,
                bio: this.bio,
                imageUrl: uploadedUrl
            });

            this.session.message = 'Profile image updated.';
            this.closeAvatarModal(true);
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('upload image'));
        } finally {
            this.uploadingProfileImage = false;
        }
    }

    removeProfileImage(): void {
        this.imageUrl = '';
        this.session.message = 'Image removed. Save profile to apply it.';
    }

    savePrefs(): void {
        this.prefs.reducedMotion = this.accessibilityPrefs.reducedMotion;
        this.prefs.largerText = this.accessibilityPrefs.largerText;
        this.prefs.highContrast = this.accessibilityPrefs.highContrast;
        this.prefs.language = this.accessibilityPrefs.language;
        this.prefs.region = this.accessibilityPrefs.region;
        localStorage.setItem(this.prefsStorageKey, JSON.stringify(this.prefs));
        this.applyThemePreference();
        this.applyAccessibilityPreferences();
        this.session.message = 'Preferences saved.';
    }

    private loadPrefs(): void {
        const stored = localStorage.getItem(this.prefsStorageKey);
        if (!stored) {
            this.prefs.darkMode = this.prefersSystemDarkMode();
            this.syncAccessibilityFromPrefs();
            this.applyAccessibilityPreferences();
            return;
        }

        try {
            const parsed = JSON.parse(stored) as Partial<typeof this.prefs>;
            this.prefs = {
                compactFeed: parsed.compactFeed ?? this.prefs.compactFeed,
                useSystemTheme: parsed.useSystemTheme ?? this.prefs.useSystemTheme,
                darkMode: parsed.darkMode ?? this.prefs.darkMode,
                reducedMotion: parsed.reducedMotion ?? this.prefs.reducedMotion,
                largerText: parsed.largerText ?? this.prefs.largerText,
                highContrast: parsed.highContrast ?? this.prefs.highContrast,
                language: parsed.language ?? this.prefs.language,
                region: parsed.region ?? this.prefs.region,
            };
        } catch {
            this.prefs = {
                compactFeed: false,
                useSystemTheme: true,
                darkMode: this.prefersSystemDarkMode(),
                reducedMotion: false,
                largerText: false,
                highContrast: false,
                language: 'system',
                region: 'system'
            };
        }

        if (this.prefs.useSystemTheme) {
            this.prefs.darkMode = this.prefersSystemDarkMode();
        }

        this.syncAccessibilityFromPrefs();
        this.applyThemePreference();
        this.applyAccessibilityPreferences();
    }

    private applyThemePreference(): void {
        document.documentElement.classList.toggle('theme-dark', !!this.prefs.darkMode);
    }

    private applyAccessibilityPreferences(): void {
        const root = document.documentElement;
        root.classList.toggle('prefers-reduced-motion', !!this.accessibilityPrefs.reducedMotion);
        root.classList.toggle('larger-text', !!this.accessibilityPrefs.largerText);
        root.classList.toggle('high-contrast', !!this.accessibilityPrefs.highContrast);
        root.setAttribute('lang', this.accessibilityPrefs.language === 'system' ? 'en' : this.accessibilityPrefs.language);
    }

    private syncAccessibilityFromPrefs(): void {
        this.accessibilityPrefs = {
            reducedMotion: !!this.prefs.reducedMotion,
            largerText: !!this.prefs.largerText,
            highContrast: !!this.prefs.highContrast,
            language: this.prefs.language ?? 'system',
            region: this.prefs.region ?? 'system'
        };

        this.initialAccessibilityPrefs = { ...this.accessibilityPrefs };
    }

    private syncPrefsFromAccessibility(): void {
        this.prefs.reducedMotion = this.accessibilityPrefs.reducedMotion;
        this.prefs.largerText = this.accessibilityPrefs.largerText;
        this.prefs.highContrast = this.accessibilityPrefs.highContrast;
        this.prefs.language = this.accessibilityPrefs.language;
        this.prefs.region = this.accessibilityPrefs.region;
    }

    private prefersSystemDarkMode(): boolean {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    private loadDiscoveryPrivacyPrefs(): void {
        const stored = localStorage.getItem(this.discoveryPrivacyStorageKey);
        if (!stored) {
            this.initialDiscoveryPrivacyPrefs = { ...this.discoveryPrivacyPrefs };
            return;
        }

        try {
            const parsed = JSON.parse(stored) as Partial<DiscoveryPrivacyPrefs>;
            this.discoveryPrivacyPrefs = {
                commentsAudience: parsed.commentsAudience ?? this.discoveryPrivacyPrefs.commentsAudience,
                mentionsAudience: parsed.mentionsAudience ?? this.discoveryPrivacyPrefs.mentionsAudience,
                messagesAudience: parsed.messagesAudience ?? this.discoveryPrivacyPrefs.messagesAudience,
                storyRepliesAudience: parsed.storyRepliesAudience ?? this.discoveryPrivacyPrefs.storyRepliesAudience,
                showInSearchSuggestions: parsed.showInSearchSuggestions ?? this.discoveryPrivacyPrefs.showInSearchSuggestions,
                allowProfileIndexing: parsed.allowProfileIndexing ?? this.discoveryPrivacyPrefs.allowProfileIndexing,
                showActivityStatus: parsed.showActivityStatus ?? this.discoveryPrivacyPrefs.showActivityStatus
            };
        } catch {
            this.discoveryPrivacyPrefs = {
                commentsAudience: 'everyone',
                mentionsAudience: 'everyone',
                messagesAudience: 'everyone',
                storyRepliesAudience: 'everyone',
                showInSearchSuggestions: true,
                allowProfileIndexing: true,
                showActivityStatus: true
            };
        }

        this.initialDiscoveryPrivacyPrefs = { ...this.discoveryPrivacyPrefs };
    }

    private loadNotificationPrefs(): void {
        const stored = localStorage.getItem(this.notificationStorageKey);
        if (!stored) {
            this.initialNotificationPrefs = { ...this.notificationPrefs };
            return;
        }

        try {
            const parsed = JSON.parse(stored) as Partial<NotificationPrefs>;
            this.notificationPrefs = {
                likes: parsed.likes ?? this.notificationPrefs.likes,
                comments: parsed.comments ?? this.notificationPrefs.comments,
                follows: parsed.follows ?? this.notificationPrefs.follows,
                mentions: parsed.mentions ?? this.notificationPrefs.mentions,
                messages: parsed.messages ?? this.notificationPrefs.messages,
                marketing: parsed.marketing ?? this.notificationPrefs.marketing,
                product: parsed.product ?? this.notificationPrefs.product,
                quietHoursEnabled: parsed.quietHoursEnabled ?? this.notificationPrefs.quietHoursEnabled,
                quietHoursStart: parsed.quietHoursStart ?? this.notificationPrefs.quietHoursStart,
                quietHoursEnd: parsed.quietHoursEnd ?? this.notificationPrefs.quietHoursEnd
            };
        } catch {
            this.notificationPrefs = {
                likes: true,
                comments: true,
                follows: true,
                mentions: true,
                messages: true,
                marketing: false,
                product: true,
                quietHoursEnabled: false,
                quietHoursStart: '22:00',
                quietHoursEnd: '07:00'
            };
        }

        this.initialNotificationPrefs = { ...this.notificationPrefs };
    }

    private loadSafetyPrefs(): void {
        const stored = localStorage.getItem(this.safetyStorageKey);
        if (!stored) {
            this.initialSafetyPrefs = {
                ...this.safetyPrefs,
                mutedKeywords: [...this.safetyPrefs.mutedKeywords],
                mutedHandles: [...this.safetyPrefs.mutedHandles]
            };
            return;
        }

        try {
            const parsed = JSON.parse(stored) as Partial<SafetyPrefs>;
            this.safetyPrefs = {
                mutedKeywords: [...(parsed.mutedKeywords ?? this.safetyPrefs.mutedKeywords)],
                sensitiveContentLevel: parsed.sensitiveContentLevel ?? this.safetyPrefs.sensitiveContentLevel,
                hideSensitiveMedia: parsed.hideSensitiveMedia ?? this.safetyPrefs.hideSensitiveMedia,
                mutedHandles: [...(parsed.mutedHandles ?? this.safetyPrefs.mutedHandles)]
            };
        } catch {
            this.safetyPrefs = {
                mutedKeywords: [],
                sensitiveContentLevel: 'standard',
                hideSensitiveMedia: false,
                mutedHandles: []
            };
        }

        this.initialSafetyPrefs = {
            ...this.safetyPrefs,
            mutedKeywords: [...this.safetyPrefs.mutedKeywords],
            mutedHandles: [...this.safetyPrefs.mutedHandles]
        };
    }

    private async loadDeviceSessionsAsync(force = false): Promise<void> {
        if (!force && this.deviceSessions.length > 0) {
            return;
        }

        try {
            const sessions = await this.session.loadAuthSessionsAsync();
            const nowMs = Date.now();
            this.deviceSessions = sessions
                .filter(session => this.isSessionActive(session, nowMs))
                .map(session => this.mapDeviceSession(session))
                .sort((left, right) => {
                    if (left.current !== right.current) {
                        return left.current ? -1 : 1;
                    }

                    return right.createdAtUtc.localeCompare(left.createdAtUtc);
                });
        } catch (error) {
            this.session.message = toUserErrorMessage(error, actionError('load active sessions'));
        }
    }

    private isSessionActive(session: AuthSessionDto, nowMs: number): boolean {
        if (session.isRevoked) {
            return false;
        }

        const expiresAtMs = Date.parse(session.expiresAtUtc);
        return Number.isNaN(expiresAtMs) || expiresAtMs > nowMs;
    }

    private mapDeviceSession(session: AuthSessionDto): DeviceSessionEntry {
        return {
            id: session.id,
            label: session.isCurrent ? 'Current session' : `Session ${session.id.slice(0, 8)}`,
            createdAtUtc: session.createdAtUtc,
            expiresAtUtc: session.expiresAtUtc,
            lastActiveUtc: session.createdAtUtc,
            current: session.isCurrent,
            revoked: session.isRevoked
        };
    }

    private loadSectionSavedAt(): void {
        const stored = localStorage.getItem(this.sectionSavedAtStorageKey);
        if (!stored) {
            return;
        }

        try {
            const parsed = JSON.parse(stored) as Partial<Record<'privacy' | 'notifications' | 'safety' | 'accessibility' | 'security' | 'data', string>>;
            this.sectionSavedAt = parsed ?? {};
        } catch {
            this.sectionSavedAt = {};
        }
    }

    private markSectionSaved(section: 'privacy' | 'notifications' | 'safety' | 'accessibility' | 'security' | 'data'): void {
        this.sectionSavedAt[section] = new Date().toISOString();
        localStorage.setItem(this.sectionSavedAtStorageKey, JSON.stringify(this.sectionSavedAt));
    }

    private areObjectsDifferent(left: unknown, right: unknown): boolean {
        return JSON.stringify(left) !== JSON.stringify(right);
    }

    private searchMutedHandleSuggestions(query: string): void {
        if (this.mutedHandleSearchDebounceId !== null) {
            window.clearTimeout(this.mutedHandleSearchDebounceId);
            this.mutedHandleSearchDebounceId = null;
        }

        this.mutedHandleSuggestionsLoading = true;
        const token = ++this.mutedHandleSearchToken;
        this.mutedHandleSearchDebounceId = window.setTimeout(async () => {
            this.mutedHandleSearchDebounceId = null;

            try {
                const profiles = await this.session.searchProfilesAsync(query);
                if (token !== this.mutedHandleSearchToken) {
                    return;
                }

                const currentHandle = this.session.profile?.handle.toLowerCase() ?? '';
                const mutedHandleSet = new Set(this.safetyPrefs.mutedHandles.map(handle => handle.toLowerCase()));
                this.mutedHandleSuggestions = profiles
                    .filter(profile => {
                        const handle = profile.handle.toLowerCase();
                        return handle !== currentHandle && !mutedHandleSet.has(handle);
                    })
                    .slice(0, 6);
                this.mutedHandleSuggestionsOpen = this.mutedHandleSuggestions.length > 0;
            } catch {
                if (token !== this.mutedHandleSearchToken) {
                    return;
                }

                this.mutedHandleSuggestions = [];
                this.mutedHandleSuggestionsOpen = false;
            } finally {
                if (token === this.mutedHandleSearchToken) {
                    this.mutedHandleSuggestionsLoading = false;
                }
            }
        }, 200);
    }

    private closeMutedHandleSuggestions(): void {
        this.mutedHandleSuggestionsOpen = false;
        this.mutedHandleSuggestions = [];
        this.mutedHandleSuggestionsLoading = false;
        this.mutedHandleSearchToken += 1;

        if (this.mutedHandleSearchDebounceId !== null) {
            window.clearTimeout(this.mutedHandleSearchDebounceId);
            this.mutedHandleSearchDebounceId = null;
        }
    }

    private extractMutedHandleQuery(value: string): string {
        return value
            .trim()
            .replace(/^@/, '')
            .toLowerCase()
            .slice(0, 30);
    }

    private normalizeHandle(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-');
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