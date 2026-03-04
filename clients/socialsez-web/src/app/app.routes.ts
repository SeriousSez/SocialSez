import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from './core/session.service';

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
    { path: 'auth', loadComponent: () => import('./pages/auth-page/auth-page.component').then(module => module.AuthPageComponent), canActivate: [guestGuard] },
    { path: 'feed', loadComponent: () => import('./pages/feed-page/feed-page.component').then(module => module.FeedPageComponent), canActivate: [authGuard] },
    { path: 'compose', loadComponent: () => import('./pages/compose-page/compose-page.component').then(module => module.ComposePageComponent), canActivate: [authGuard] },
    { path: 'discover', loadComponent: () => import('./pages/discover-page/discover-page.component').then(module => module.DiscoverPageComponent) },
    { path: 'communities', loadComponent: () => import('./pages/communities-page/communities-page.component').then(module => module.CommunitiesPageComponent), canActivate: [authGuard] },
    { path: 'communities/:slug', loadComponent: () => import('./pages/community-detail-page/community-detail-page.component').then(module => module.CommunityDetailPageComponent), canActivate: [authGuard] },
    { path: 'chat', loadComponent: () => import('./pages/chat-page/chat-page.component').then(module => module.ChatPageComponent), canActivate: [authGuard] },
    { path: 'hashtags/:tag', loadComponent: () => import('./pages/hashtag-page/hashtag-page.component').then(module => module.HashtagPageComponent) },
    { path: 'profile', loadComponent: () => import('./pages/profile-page/profile-page.component').then(module => module.ProfilePageComponent), canActivate: [authGuard] },
    { path: 'users/:handle', loadComponent: () => import('./pages/profile-page/profile-page.component').then(module => module.ProfilePageComponent) },
    { path: 'notifications', loadComponent: () => import('./pages/notifications-page/notifications-page.component').then(module => module.NotificationsPageComponent), canActivate: [authGuard] },
    { path: 'notifications/requests', loadComponent: () => import('./pages/notification-requests-page/notification-requests-page.component').then(module => module.NotificationRequestsPageComponent), canActivate: [authGuard] },
    { path: 'settings', loadComponent: () => import('./pages/settings-page/settings-page.component').then(module => module.SettingsPageComponent), canActivate: [authGuard] },
    { path: 'shared/post/:id', loadComponent: () => import('./pages/shared-post-page/shared-post-page.component').then(module => module.SharedPostPageComponent) },
    { path: 'shared/community-post/:id', loadComponent: () => import('./pages/shared-community-post-page/shared-community-post-page.component').then(module => module.SharedCommunityPostPageComponent) },
    { path: 'shared/reel/:id', loadComponent: () => import('./pages/shared-reel-page/shared-reel-page.component').then(module => module.SharedReelPageComponent) },
    { path: 'shared/story/:id', loadComponent: () => import('./pages/shared-story-page/shared-story-page.component').then(module => module.SharedStoryPageComponent) },
    { path: '**', redirectTo: 'feed' }
];
