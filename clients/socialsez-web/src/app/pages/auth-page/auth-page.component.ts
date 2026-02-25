import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionService } from '../../core/session.service';

@Component({
    selector: 'app-auth-page',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './auth-page.component.html',
    styleUrl: './auth-page.component.scss'
})
export class AuthPageComponent {
    mode: 'login' | 'register' = 'login';
    isSubmitting = false;
    private readonly minimumSubmitLoadingMs = 450;

    email = '';
    password = '';
    handle = '';
    displayName = '';
    bio = '';
    errorMessage = '';

    constructor(public readonly session: SessionService) { }

    onHandleInput(value: string): void {
        this.handle = this.normalizeHandle(value);
    }

    setMode(nextMode: 'login' | 'register'): void {
        this.mode = nextMode;
        this.errorMessage = '';
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
                bio: this.bio
            });
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
            });
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

    private extractApiMessage(error: unknown, fallback: string): string {
        const maybeMessage = (error as { error?: { message?: string } })?.error?.message;
        if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
            return maybeMessage;
        }

        return fallback;
    }
}