import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from './core/session.service';
import { AuthPageComponent } from './pages/auth-page/auth-page.component';
import { FeedPageComponent } from './pages/feed-page/feed-page.component';
import { ComposePageComponent } from './pages/compose-page/compose-page.component';
import { DiscoverPageComponent } from './pages/discover-page/discover-page.component';
import { ChatPageComponent } from './pages/chat-page/chat-page.component';
import { SettingsPageComponent } from './pages/settings-page/settings-page.component';
import { ProfilePageComponent } from './pages/profile-page/profile-page.component';
import { HashtagPageComponent } from './pages/hashtag-page/hashtag-page.component';
import { NotificationsPageComponent } from './pages/notifications-page/notifications-page.component';
import { NotificationRequestsPageComponent } from './pages/notification-requests-page/notification-requests-page.component';
import { SharedPostPageComponent } from './pages/shared-post-page/shared-post-page.component';
import { SharedReelPageComponent } from './pages/shared-reel-page/shared-reel-page.component';
import { SharedStoryPageComponent } from './pages/shared-story-page/shared-story-page.component';

const authGuard = async () => {
    const session = inject(SessionService);
    const router = inject(Router);

    await session.bootstrapAsync();
    return session.isAuthenticated() ? true : router.createUrlTree(['/auth']);
};

const guestGuard = async () => {
    const session = inject(SessionService);
    const router = inject(Router);

    await session.bootstrapAsync();
    return session.isAuthenticated() ? router.createUrlTree(['/profile']) : true;
};

export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'feed' },
    { path: 'auth', component: AuthPageComponent, canActivate: [guestGuard] },
    { path: 'feed', component: FeedPageComponent, canActivate: [authGuard] },
    { path: 'compose', component: ComposePageComponent, canActivate: [authGuard] },
    { path: 'discover', component: DiscoverPageComponent },
    { path: 'chat', component: ChatPageComponent, canActivate: [authGuard] },
    { path: 'hashtags/:tag', component: HashtagPageComponent, canActivate: [authGuard] },
    { path: 'profile', component: ProfilePageComponent, canActivate: [authGuard] },
    { path: 'users/:handle', component: ProfilePageComponent },
    { path: 'notifications', component: NotificationsPageComponent, canActivate: [authGuard] },
    { path: 'notifications/requests', component: NotificationRequestsPageComponent, canActivate: [authGuard] },
    { path: 'settings', component: SettingsPageComponent, canActivate: [authGuard] },
    { path: 'shared/post/:id', component: SharedPostPageComponent },
    { path: 'shared/reel/:id', component: SharedReelPageComponent },
    { path: 'shared/story/:id', component: SharedStoryPageComponent },
    { path: '**', redirectTo: 'feed' }
];
