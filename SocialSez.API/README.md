# SocialSez Backend

MVP backend for a personal social platform, structured with separate projects:

- `SocialSez.API` - HTTP API and controllers
- `SocialSez.ApplicationService` - business logic/services
- `SocialSez.Domain` - entities
- `SocialSez.Infrastructure` - EF Core context and database wiring

## Run

```bash
dotnet build SocialSez.slnx
dotnet run --project SocialSez.API
```

In `DEBUG`, the app uses SQLite (`ConnectionStrings:Sqlite`) so data persists across restarts without extra setup. In non-debug builds, it uses MySQL from `ConnectionStrings:MySql`.

## MySQL schema update

If you deployed a database created before the handle cooldown feature, apply this script once:

- `artifacts/db/mysql/2026-02-25-add-last-handle-change-at-utc.sql`

It adds `UserProfiles.LastHandleChangeAtUtc` in an idempotent way so login/profile queries do not fail.

## Stories and Reels API (MVP)

All endpoints require JWT auth.

- Stories
  - `POST /api/stories` (`multipart/form-data`: `media`, optional `caption`, optional `expiresInHours`)
  - `GET /api/stories/feed?takeAuthors=25`
  - `POST /api/stories/{storyId}/view`
  - `DELETE /api/stories/{storyId}`

- Reels
  - `POST /api/reels` (`multipart/form-data`: `video`, optional `thumbnail`, optional `caption`, required `durationSeconds`)
  - `GET /api/reels/feed?take=25`
  - `POST /api/reels/{reelId}/like`
  - `DELETE /api/reels/{reelId}`
