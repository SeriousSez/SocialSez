import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SessionService } from '../../core/session.service';
import { HashtagSearchResultDto } from '../../core/api.types';

@Component({
    selector: 'app-auth-page',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './auth-page.component.html',
    styleUrl: './auth-page.component.scss'
})
export class AuthPageComponent {
    mode: 'login' | 'register' = 'login';
    registerStep: 'account' | 'interests' = 'account';
    isSubmitting = false;
    private readonly minimumSubmitLoadingMs = 450;

    email = '';
    password = '';
    confirmPassword = '';
    showLoginPassword = false;
    staySignedIn = true;
    showRegisterPassword = false;
    showConfirmPassword = false;
    handle = '';
    displayName = '';
    bio = '';
    birthMonth = '';
    birthDay = '';
    birthYear = '';
    countryCode = '';
    marketingOptIn = false;
    isPrivateByDefault = false;
    acceptedTerms = false;
    selectedInterests: string[] = [];
    suggestedInterests: HashtagSearchResultDto[] = [];
    errorMessage = '';
    readonly monthOptions = Array.from({ length: 12 }, (_, index) => `${index + 1}`.padStart(2, '0'));
    readonly dayOptions = Array.from({ length: 31 }, (_, index) => `${index + 1}`.padStart(2, '0'));
    readonly yearOptions = Array.from({ length: 110 }, (_, index) => `${new Date().getFullYear() - index}`);
    readonly countries: ReadonlyArray<{ code: string; name: string }> = [
        { code: 'AR', name: 'Argentina' },
        { code: 'AU', name: 'Australia' },
        { code: 'AT', name: 'Austria' },
        { code: 'BE', name: 'Belgium' },
        { code: 'BR', name: 'Brazil' },
        { code: 'BG', name: 'Bulgaria' },
        { code: 'CA', name: 'Canada' },
        { code: 'CL', name: 'Chile' },
        { code: 'CN', name: 'China' },
        { code: 'CO', name: 'Colombia' },
        { code: 'CR', name: 'Costa Rica' },
        { code: 'HR', name: 'Croatia' },
        { code: 'CY', name: 'Cyprus' },
        { code: 'CZ', name: 'Czechia' },
        { code: 'DK', name: 'Denmark' },
        { code: 'EG', name: 'Egypt' },
        { code: 'EE', name: 'Estonia' },
        { code: 'FI', name: 'Finland' },
        { code: 'FR', name: 'France' },
        { code: 'DE', name: 'Germany' },
        { code: 'GR', name: 'Greece' },
        { code: 'HK', name: 'Hong Kong' },
        { code: 'HU', name: 'Hungary' },
        { code: 'IS', name: 'Iceland' },
        { code: 'IN', name: 'India' },
        { code: 'ID', name: 'Indonesia' },
        { code: 'IE', name: 'Ireland' },
        { code: 'IL', name: 'Israel' },
        { code: 'IT', name: 'Italy' },
        { code: 'JP', name: 'Japan' },
        { code: 'KE', name: 'Kenya' },
        { code: 'LV', name: 'Latvia' },
        { code: 'LT', name: 'Lithuania' },
        { code: 'LU', name: 'Luxembourg' },
        { code: 'MY', name: 'Malaysia' },
        { code: 'MT', name: 'Malta' },
        { code: 'MX', name: 'Mexico' },
        { code: 'MA', name: 'Morocco' },
        { code: 'NL', name: 'Netherlands' },
        { code: 'NZ', name: 'New Zealand' },
        { code: 'NG', name: 'Nigeria' },
        { code: 'NO', name: 'Norway' },
        { code: 'PK', name: 'Pakistan' },
        { code: 'PE', name: 'Peru' },
        { code: 'PH', name: 'Philippines' },
        { code: 'PL', name: 'Poland' },
        { code: 'PT', name: 'Portugal' },
        { code: 'RO', name: 'Romania' },
        { code: 'SA', name: 'Saudi Arabia' },
        { code: 'RS', name: 'Serbia' },
        { code: 'SG', name: 'Singapore' },
        { code: 'SK', name: 'Slovakia' },
        { code: 'SI', name: 'Slovenia' },
        { code: 'ZA', name: 'South Africa' },
        { code: 'KR', name: 'South Korea' },
        { code: 'ES', name: 'Spain' },
        { code: 'SE', name: 'Sweden' },
        { code: 'CH', name: 'Switzerland' },
        { code: 'TW', name: 'Taiwan' },
        { code: 'TH', name: 'Thailand' },
        { code: 'TR', name: 'Turkey' },
        { code: 'UA', name: 'Ukraine' },
        { code: 'AE', name: 'United Arab Emirates' },
        { code: 'GB', name: 'United Kingdom' },
        { code: 'US', name: 'United States' },
        { code: 'UY', name: 'Uruguay' },
        { code: 'VN', name: 'Vietnam' }
    ];

    constructor(
        public readonly session: SessionService,
        private readonly router: Router
    ) { }

    onHandleInput(value: string): void {
        this.handle = this.normalizeHandle(value);
    }

    setMode(nextMode: 'login' | 'register'): void {
        this.mode = nextMode;
        this.registerStep = 'account';
        this.errorMessage = '';
        this.showLoginPassword = false;
        this.showRegisterPassword = false;
        this.showConfirmPassword = false;

        if (nextMode === 'register' && this.suggestedInterests.length === 0) {
            void this.loadSuggestedInterests();
        }
    }

    toggleLoginPasswordVisibility(): void {
        this.showLoginPassword = !this.showLoginPassword;
    }

    toggleRegisterPasswordVisibility(): void {
        this.showRegisterPassword = !this.showRegisterPassword;
    }

    toggleConfirmPasswordVisibility(): void {
        this.showConfirmPassword = !this.showConfirmPassword;
    }

    async register(): Promise<void> {
        this.errorMessage = '';
        try {
            const normalizedHandle = this.normalizeHandle(this.handle);
            this.handle = normalizedHandle;

            await this.session.registerAsync({
                email: this.email,
                password: this.password,
                handle: normalizedHandle,
                displayName: this.displayName,
                bio: this.bio,
                dateOfBirth: this.composedDateOfBirth,
                countryCode: this.countryCode?.trim() ? this.countryCode.trim().toUpperCase() : undefined,
                marketingOptIn: this.marketingOptIn,
                isPrivateByDefault: this.isPrivateByDefault
            }, false);

            this.registerStep = 'interests';
        } catch (error) {
            this.errorMessage = this.extractApiMessage(error, 'Could not register with these details.');
        }
    }

    async login(): Promise<void> {
        this.errorMessage = '';
        try {
            await this.session.loginAsync({
                email: this.email,
                password: this.password
            }, this.staySignedIn);
        } catch {
            this.errorMessage = 'Invalid credentials.';
        }
    }

    async submit(): Promise<void> {
        if (this.isSubmitting) {
            return;
        }

        this.isSubmitting = true;
        const startedAt = Date.now();

        try {
            if (this.mode === 'login') {
                await this.login();
                return;
            }

            if (this.registerStep === 'interests') {
                await this.completeInterestsOnboarding();
                return;
            }

            if (!this.canSubmitRegistrationAccountStep) {
                this.errorMessage = this.registrationValidationMessage;
                return;
            }

            await this.register();
        } finally {
            const elapsed = Date.now() - startedAt;
            const remaining = this.minimumSubmitLoadingMs - elapsed;
            if (remaining > 0) {
                await new Promise<void>(resolve => window.setTimeout(resolve, remaining));
            }

            this.isSubmitting = false;
        }
    }

    private normalizeHandle(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-');
    }

    get normalizedHandlePreview(): string {
        return this.normalizeHandle(this.handle);
    }

    get passwordStrengthLabel(): 'Weak' | 'Medium' | 'Strong' {
        const password = this.password ?? '';
        let score = 0;

        if (password.length >= 8) {
            score += 1;
        }

        if (/[A-Z]/.test(password) && /[a-z]/.test(password)) {
            score += 1;
        }

        if (/\d/.test(password) || /[^\w\s]/.test(password)) {
            score += 1;
        }

        if (score <= 1) {
            return 'Weak';
        }

        if (score === 2) {
            return 'Medium';
        }

        return 'Strong';
    }

    get registrationValidationMessage(): string {
        if (!this.email.trim()) {
            return 'Email is required.';
        }

        if (!this.password) {
            return 'Password is required.';
        }

        if (this.password.length < 8) {
            return 'Password must be at least 8 characters.';
        }

        if (this.password !== this.confirmPassword) {
            return 'Passwords do not match.';
        }

        if (!this.normalizedHandlePreview) {
            return 'Handle is required.';
        }

        if (!this.displayName.trim()) {
            return 'Display name is required.';
        }

        if (this.hasAnyBirthPart && !this.composedDateOfBirth) {
            return 'Please select a complete valid birth date.';
        }

        if (this.composedDateOfBirth && this.calculateAgeFromDate(this.composedDateOfBirth) < 13) {
            return 'You must be at least 13 years old to register.';
        }

        if (!this.acceptedTerms) {
            return 'You need to accept the terms to create an account.';
        }

        return '';
    }

    get canSubmitRegistrationAccountStep(): boolean {
        return this.registrationValidationMessage.length === 0;
    }

    get hasAnyBirthPart(): boolean {
        return !!(this.birthYear || this.birthMonth || this.birthDay);
    }

    get composedDateOfBirth(): string | undefined {
        if (!this.birthYear || !this.birthMonth || !this.birthDay) {
            return undefined;
        }

        const raw = `${this.birthYear}-${this.birthMonth}-${this.birthDay}`;
        const parsed = new Date(`${raw}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime())) {
            return undefined;
        }

        const [year, month, day] = raw.split('-').map(value => Number.parseInt(value, 10));
        if (
            parsed.getUTCFullYear() !== year
            || parsed.getUTCMonth() + 1 !== month
            || parsed.getUTCDate() !== day
        ) {
            return undefined;
        }

        return raw;
    }

    toggleInterest(tag: string): void {
        const normalized = this.normalizeTag(tag);
        if (!normalized) {
            return;
        }

        if (this.selectedInterests.includes(normalized)) {
            this.selectedInterests = this.selectedInterests.filter(item => item !== normalized);
            return;
        }

        this.selectedInterests = [...this.selectedInterests, normalized].slice(0, 12);
    }

    isInterestSelected(tag: string): boolean {
        const normalized = this.normalizeTag(tag);
        return !!normalized && this.selectedInterests.includes(normalized);
    }

    async skipInterests(): Promise<void> {
        if (this.isSubmitting) {
            return;
        }

        await this.session.refreshSessionAsync(true);
        await this.router.navigateByUrl('/feed');
    }

    private async completeInterestsOnboarding(): Promise<void> {
        const tags = this.selectedInterests.slice(0, 12);
        if (tags.length > 0) {
            const results = await Promise.allSettled(tags.map(tag => this.session.followHashtagAsync(tag)));
            const failedCount = results.filter(result => result.status === 'rejected').length;

            if (failedCount > 0 && failedCount === tags.length) {
                this.errorMessage = 'We created your account, but could not save interests right now.';
            }
        }

        await this.session.refreshSessionAsync(true);
        await this.router.navigateByUrl('/feed');
    }

    private async loadSuggestedInterests(): Promise<void> {
        try {
            const results = await this.session.loadTrendingHashtagsAsync(18);
            this.suggestedInterests = results.filter(item => !!this.normalizeTag(item.tag)).slice(0, 18);
        } catch {
            this.suggestedInterests = [];
        }
    }

    private normalizeTag(value: string): string {
        return (value ?? '')
            .trim()
            .replace(/^#/, '')
            .toLowerCase();
    }

    private calculateAgeFromDate(rawDate: string): number {
        const parsed = new Date(rawDate);
        if (Number.isNaN(parsed.getTime())) {
            return 0;
        }

        const today = new Date();
        let age = today.getFullYear() - parsed.getFullYear();
        const monthDiff = today.getMonth() - parsed.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) {
            age -= 1;
        }

        return age;
    }

    private extractApiMessage(error: unknown, fallback: string): string {
        const maybeMessage = (error as { error?: { message?: string } })?.error?.message;
        if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
            return maybeMessage;
        }

        return fallback;
    }
}