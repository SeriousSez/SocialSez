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

    email = '';
    password = '';
    handle = '';
    displayName = '';
    bio = '';
    errorMessage = '';

    constructor(public readonly session: SessionService) { }

    setMode(nextMode: 'login' | 'register'): void {
        this.mode = nextMode;
        this.errorMessage = '';
    }

    async register(): Promise<void> {
        this.errorMessage = '';
        try {
            await this.session.registerAsync({
                email: this.email,
                password: this.password,
                handle: this.handle,
                displayName: this.displayName,
                bio: this.bio
            });
        } catch {
            this.errorMessage = 'Could not register with these details.';
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
        if (this.mode === 'login') {
            await this.login();
            return;
        }

        await this.register();
    }
}