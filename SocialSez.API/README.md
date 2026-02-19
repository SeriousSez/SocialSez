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
