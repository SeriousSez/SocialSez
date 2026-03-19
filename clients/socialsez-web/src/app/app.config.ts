import { APP_INITIALIZER, ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { HttpInterceptorFn, HttpResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { map } from 'rxjs';
import { AppLanguageService } from './core/app-language.service';
import { normalizeUtcDateFields, resolveAppLocale } from './core/date-time.util';
import { environment } from '../environments/environment';
import { routes } from './app.routes';

const normalizeUtcDateInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    map(event => {
      if (!(event instanceof HttpResponse) || event.body == null) {
        return event;
      }

      return event.clone({
        body: normalizeUtcDateFields(event.body)
      });
    })
  );

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([normalizeUtcDateInterceptor])),
    provideTranslateService({ fallbackLang: 'en' }),
    provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json' }),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: (language: AppLanguageService) => () => language.initializeAsync(),
      deps: [AppLanguageService]
    },
    {
      provide: LOCALE_ID,
      useFactory: resolveAppLocale
    },
    provideRouter(routes),
    provideServiceWorker('sw.js', {
      enabled: environment.production,
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
