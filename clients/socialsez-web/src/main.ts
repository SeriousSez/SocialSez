import 'zone.js';
import { registerLocaleData } from '@angular/common';
import localeDa from '@angular/common/locales/da';
import localeEnGb from '@angular/common/locales/en-GB';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app-shell/app.component';

registerLocaleData(localeDa);
registerLocaleData(localeEnGb);

try {
  const storedPrefs = localStorage.getItem('socialsez-web-prefs');
  if (storedPrefs) {
    const parsedPrefs = JSON.parse(storedPrefs) as { darkMode?: boolean };
    document.documentElement.classList.toggle('theme-dark', !!parsedPrefs.darkMode);
  }
} catch {
  document.documentElement.classList.remove('theme-dark');
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
