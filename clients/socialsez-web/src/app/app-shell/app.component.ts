import { CommonModule } from '@angular/common';
import { Component, OnInit, isDevMode } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionService } from '../core/session.service';

@Component({
    selector: 'app-root',
    imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
    readonly showDebug = isDevMode();
    working = false;
    searchText = '';

    constructor(public readonly session: SessionService, private readonly router: Router) { }

    ngOnInit(): void {
        void this.session.bootstrapAsync();
    }

    async logout(): Promise<void> {
        this.working = true;
        try {
            await this.session.logoutAsync();
        } finally {
            this.working = false;
        }
    }

    async searchNow(): Promise<void> {
        const query = this.searchText.trim();
        if (!query) {
            return;
        }

        await this.router.navigate(['/discover'], { queryParams: { q: query, type: 'all' } });
    }
}
