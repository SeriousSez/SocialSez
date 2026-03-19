import 'zone.js';
import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeDa from '@angular/common/locales/da';
import localeDe from '@angular/common/locales/de';
import localeEnGb from '@angular/common/locales/en-GB';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import localeIt from '@angular/common/locales/it';
import localeNb from '@angular/common/locales/nb';
import localeNl from '@angular/common/locales/nl';
import localePl from '@angular/common/locales/pl';
import localePt from '@angular/common/locales/pt';
import localeSv from '@angular/common/locales/sv';
import localeTr from '@angular/common/locales/tr';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app-shell/app.component';
import { resolveDocumentDirection, resolveDocumentLanguage } from './app/core/app-language.util';

registerLocaleData(localeAr);
registerLocaleData(localeDa);
registerLocaleData(localeDe);
registerLocaleData(localeEnGb);
registerLocaleData(localeEs);
registerLocaleData(localeFr);
registerLocaleData(localeIt);
registerLocaleData(localeNb);
registerLocaleData(localeNl);
registerLocaleData(localePl);
registerLocaleData(localePt, 'pt-BR');
registerLocaleData(localeSv);
registerLocaleData(localeTr);

try {
  document.documentElement.setAttribute('lang', resolveDocumentLanguage());
  document.documentElement.setAttribute('dir', resolveDocumentDirection());

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
