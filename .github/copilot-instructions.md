# SocialSez – Copilot Instructions

## Project Overview

SocialSez is a social platform with:

- **`SocialSez.API`** — ASP.NET Core 8 Web API
- **`SocialSez.ApplicationService`** — application logic layer (interfaces + services + models)
- **`SocialSez.Domain`** — domain entities
- **`SocialSez.Infrastructure`** — EF Core `SocialSezContext`, migrations, DB config (MySQL or SQLite)
- **`clients/socialsez-web`** — Angular 17 standalone web client
- **`clients/socialsez_mobile`** — Flutter mobile client

---

## Angular Web Client (`clients/socialsez-web`)

### Components

- All components use `standalone: true` with explicit `imports: [...]`.
- Use `inject()` for dependency injection — never add constructor parameters.
- Use `DestroyRef` + `takeUntilDestroyed(destroyRef)` to clean up subscriptions.
- Always use `ChangeDetectorRef` and `this.cdr.detectChanges();` after async operations that update view state.
- Never use browser prompts (`alert`, `confirm`, `prompt`) — use the existing `SessionService.showNotice()`, existing modal components or create a custom modal component if needed.
- Import `CommonModule` when the template needs `*ngIf`, `*ngFor`, `| async`, etc.
- Use `ActivatedRoute` (not `Router.parseUrl`) to read route params and query strings.
- Use `queryParamMap` / `paramMap` observables with `takeUntilDestroyed` for param changes.
- Always use skeleton loaders for async content — never leave blank spaces or spinners.
- Try to reuse existing components and services from `core/` or `shared/` when possible — don't create new ones without checking first.
- For new components, use the Angular CLI generator: `ng generate component my-component --standalone --skip-tests`.
- Use confirm modal for deletions and other destructive actions, with clear messaging about what will be deleted and any consequences.

```ts
// Preferred DI pattern
private readonly session = inject(SessionService);
private readonly destroyRef = inject(DestroyRef);
```

### State & Cross-Component Communication

- Use RxJS `Subject` or `ReplaySubject` on a shared `@Injectable({ providedIn: 'root' })` service to pass data between unrelated components (e.g. `SessionService.openReelInModal$`).
- Expose `Subject` only as `Observable` to consumers (`.asObservable()`).
- Do not use `BehaviorSubject` for transient actions — use `Subject`.

### Templates

- Use `@if` / `@for` (new control flow) for new templates; use `*ngIf` / `*ngFor` only when touching existing code that already uses it.
- Avoid `*ngIf="flagOrValue as alias"` when `flag` can be truthy — the alias becomes `true` instead of the value. Use two separate `*ngIf` directives instead.

### SCSS / Styling

- Component SCSS is fully scoped. Use flat, readable class names (not strict BEM).
- Use CSS custom properties from `src/styles/_colors.scss` for all colors. Key tokens:
  - `--color-primary`, `--color-text`, `--color-border`, `--color-surface`, `--color-surface-alt`
  - `--gradient-primary`, `--gradient-surface`
- Do not hard-code neutral UI colors in component SCSS (`#fff`, `#f8fafc`, `#e2e8f0`, etc.) for cards, panels, inputs, text, borders, or chips — use the existing color tokens instead.
- If a literal color/gradient is required (for brand accents, media overlays, badges, etc.), add an explicit `:host-context(.theme-dark)` override so contrast remains correct in dark mode.
- Any new/updated web UI styles must be visually valid in both light and dark themes before finishing.
- Card / panel "resting" style: `background: #fff; border: 1px solid #dbe4f0; border-radius: 12px; padding: 12px;`
- Button default style comes from `src/styles/_buttons.scss` — don't duplicate it.
- Loading spinners: add class `is-loading` to the `<button>`.
- Dark mode: override tokens under `:root.theme-dark` in `_colors.scss`.
- Budget-sensitive file: `chat-page` component SCSS is near the Angular budget limit — avoid expanding it unnecessarily.

### Icons

- Use Font Awesome Duotone Thin icons: `<i class="fa-duotone fa-thin fa-<icon-name>"></i>`

### API / Services

- All HTTP calls go through `SocialSezApiService` — never call `HttpClient` directly from a component.
- `SessionService` is the app-wide state store (current profile, saved items, notices, etc.).
- Display user-facing errors via `session.showNotice(message, true)`.

### Routing

- Lazy-loaded routes defined in `app.routes.ts`.
- Right-rail components (right `aside`) are conditionally rendered in `app.component.html` based on the current route (`router.url`).
- Right-rail cards match the "resting card" style above.

---

## .NET API (`SocialSez.API`)

### Controllers

- Use primary constructor injection: `public class MyController(IMyService svc) : ControllerBase`.
- Extract the authenticated profile ID with the existing `TryGetProfileId(out var profileId)` helper; return `Unauthorized()` when it returns false.
- Return `NotFound()` for null service results, `Forbid()` for access violations, `BadRequest(new { message })` for argument errors.
- Decorate mutating endpoints with `[Authorize]`.
- Always pass `CancellationToken cancellationToken` from action parameters to service calls.

### ApplicationService Layer

- Every feature area has an `IXxxService` interface in `Interfaces/` and a concrete `XxxService` in `Services/`.
- Register new services in `SocialSez.ApplicationService/Extensions/ServiceCollectionExtensions.cs` as **Scoped**.
- DTOs are `record` types defined in `Models/`.
- Services receive `SocialSezContext` and (if needed) `IMemoryCache` via primary constructor.

### Domain / Infrastructure

- Entities live in `SocialSez.Domain/Entities/`.
- `SocialSezContext` is the single EF Core context; never create a second one.
- Database migrations live in `SocialSez.Infrastructure/Migrations/`. Generate new migrations with `dotnet ef migrations add <Name> --project SocialSez.Infrastructure --startup-project SocialSez.API`.

### General .NET Rules

- Use `async`/`await` throughout — no `.Result` or `.Wait()`.
- Prefer `IReadOnlyCollection<T>` return types for lists.
- Use `StringComparer.Ordinal` or `OrdinalIgnoreCase` for string comparisons in sets/dictionaries.
- Constants and static readonly fields go at the top of the class, before instance fields.

---

## Cross-Cutting Rules

- **No duplicate logic**: if a utility already exists in `core/` (Angular) or a service already exists (API), use it — don't reimplement it inline.
- **No console.log / Debug.WriteLine** left in committed code.
- **Security**: sanitize user-supplied strings before storing; never interpolate raw input into HTML; auth checks happen in controllers, not services.
- **Build must pass**: after any change, run `npm run build` (web) or `dotnet build` (API) and fix all errors before finishing.
