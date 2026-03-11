import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { HttpInterceptorFn, HttpResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { map } from 'rxjs';
import { normalizeUtcDateFields, resolveAppLocale } from './core/date-time.util';
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
    {
      provide: LOCALE_ID,
      useFactory: resolveAppLocale
    },
    provideRouter(routes),
    provideServiceWorker('sw.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
