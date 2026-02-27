using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SocialSez.API.Hubs;
using SocialSez.ApplicationService.Extensions;
using SocialSez.Infrastructure.Extensions;
using SocialSez.Infrastructure;
using SocialSez.API.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

const long MaxUploadBytes = 512L * 1024L * 1024L;

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = MaxUploadBytes;
});

builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = MaxUploadBytes;
});

builder.Services.AddSocialSezInfrastructure(builder.Configuration);
builder.Services.AddSocialSezApplication();
builder.Services.AddSignalR();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

var configuredCorsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();
var allowedCorsOrigins = (configuredCorsOrigins is { Length: > 0 }
    ? configuredCorsOrigins
    : new[]
    {
        "http://localhost:4200",
        "https://localhost:4200",
        "https://venli.sezginsahin.dk"
    })
    .Where(origin => !string.IsNullOrWhiteSpace(origin))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy("ClientApps", policy =>
    {
        policy.WithOrigins(allowedCorsOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "SocialSez";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "SocialSez.Clients";
var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey))
{
    jwtKey = "SocialSez-Super-Secret-Key-Replace-In-Production-2026";
}

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
}).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtIssuer,
        ValidAudience = jwtAudience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
    };

    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"];
            var path = context.HttpContext.Request.Path;
            if (!string.IsNullOrWhiteSpace(accessToken) && path.StartsWithSegments("/hubs/chat"))
            {
                context.Token = accessToken;
            }

            return Task.CompletedTask;
        }
    };
});

builder.Services.AddAuthorization();

builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter JWT Bearer token"
    });

    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

using (var scope = app.Services.CreateScope())
{
    try
    {
        var dbContext = scope.ServiceProvider.GetRequiredService<SocialSezContext>();
        dbContext.Database.EnsureCreated();

        if (dbContext.Database.IsSqlite())
        {
            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS PostReactions (
                PostId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                Type TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (PostId, ProfileId),
                FOREIGN KEY (PostId) REFERENCES Posts (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_PostReactions_PostId_Type
            ON PostReactions (PostId, Type);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommentReactions (
                CommentId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                Type TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (CommentId, ProfileId),
                FOREIGN KEY (CommentId) REFERENCES Comments (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_CommentReactions_CommentId_Type
            ON CommentReactions (CommentId, Type);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ChatConversations (
                Id TEXT NOT NULL PRIMARY KEY,
                CreatedByProfileId TEXT NOT NULL,
                IsGroup INTEGER NOT NULL,
                Title TEXT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (CreatedByProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ChatConversationMembers (
                ConversationId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                JoinedAtUtc TEXT NOT NULL,
                PRIMARY KEY (ConversationId, ProfileId),
                FOREIGN KEY (ConversationId) REFERENCES ChatConversations (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ChatConversationMembers_ProfileId
            ON ChatConversationMembers (ProfileId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ChatMessages (
                Id TEXT NOT NULL PRIMARY KEY,
                ConversationId TEXT NOT NULL,
                AuthorProfileId TEXT NOT NULL,
                Content TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (ConversationId) REFERENCES ChatConversations (Id) ON DELETE CASCADE,
                FOREIGN KEY (AuthorProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ChatMessages_ConversationId_CreatedAtUtc
            ON ChatMessages (ConversationId, CreatedAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ChatMessageReactions (
                MessageId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                Type TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (MessageId, ProfileId),
                FOREIGN KEY (MessageId) REFERENCES ChatMessages (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ChatMessageReactions_MessageId_Type
            ON ChatMessageReactions (MessageId, Type);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS Stories (
                Id TEXT NOT NULL PRIMARY KEY,
                AuthorId TEXT NOT NULL,
                Caption TEXT NULL,
                MediaUrl TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                ExpiresAtUtc TEXT NOT NULL,
                FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_Stories_AuthorId_CreatedAtUtc
            ON Stories (AuthorId, CreatedAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_Stories_ExpiresAtUtc
            ON Stories (ExpiresAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS StoryViews (
                StoryId TEXT NOT NULL,
                ViewerId TEXT NOT NULL,
                ViewedAtUtc TEXT NOT NULL,
                PRIMARY KEY (StoryId, ViewerId),
                FOREIGN KEY (StoryId) REFERENCES Stories (Id) ON DELETE CASCADE,
                FOREIGN KEY (ViewerId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_StoryViews_ViewerId
            ON StoryViews (ViewerId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS Reels (
                Id TEXT NOT NULL PRIMARY KEY,
                AuthorId TEXT NOT NULL,
                Caption TEXT NULL,
                VideoUrl TEXT NOT NULL,
                ThumbnailUrl TEXT NULL,
                DurationSeconds INTEGER NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_Reels_CreatedAtUtc
            ON Reels (CreatedAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_Reels_AuthorId
            ON Reels (AuthorId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ReelLikes (
                ReelId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (ReelId, ProfileId),
                FOREIGN KEY (ReelId) REFERENCES Reels (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ReelLikes_ProfileId
            ON ReelLikes (ProfileId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ReelComments (
                Id TEXT NOT NULL PRIMARY KEY,
                ReelId TEXT NOT NULL,
                AuthorId TEXT NOT NULL,
                ParentCommentId TEXT NULL,
                Content TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (ReelId) REFERENCES Reels (Id) ON DELETE CASCADE,
                FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT,
                FOREIGN KEY (ParentCommentId) REFERENCES ReelComments (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ReelCommentLikes (
                ReelCommentId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (ReelCommentId, ProfileId),
                FOREIGN KEY (ReelCommentId) REFERENCES ReelComments (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ReelCommentLikes_ProfileId
            ON ReelCommentLikes (ProfileId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ReelComments_ReelId_CreatedAtUtc
            ON ReelComments (ReelId, CreatedAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ReelComments_AuthorId
            ON ReelComments (AuthorId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS ProfileFollowRequests (
                FollowerId TEXT NOT NULL,
                FollowedId TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                RespondedAtUtc TEXT NULL,
                Status TEXT NOT NULL,
                PRIMARY KEY (FollowerId, FollowedId),
                FOREIGN KEY (FollowerId) REFERENCES UserProfiles (Id) ON DELETE CASCADE,
                FOREIGN KEY (FollowedId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_ProfileFollowRequests_FollowedId_Status_CreatedAtUtc
            ON ProfileFollowRequests (FollowedId, Status, CreatedAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS Notifications (
                Id TEXT NOT NULL PRIMARY KEY,
                RecipientId TEXT NOT NULL,
                ActorId TEXT NULL,
                Type TEXT NOT NULL,
                Message TEXT NOT NULL,
                ReferenceId TEXT NULL,
                IsRead INTEGER NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (RecipientId) REFERENCES UserProfiles (Id) ON DELETE CASCADE,
                FOREIGN KEY (ActorId) REFERENCES UserProfiles (Id) ON DELETE SET NULL
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_Notifications_RecipientId_IsRead_CreatedAtUtc
            ON Notifications (RecipientId, IsRead, CreatedAtUtc);
            """);

            var columnExists = dbContext.Database
                .SqlQueryRaw<int>("SELECT 1 FROM pragma_table_info('UserProfiles') WHERE name = 'IsPrivate'")
                .ToList()
                .Count > 0;

            if (!columnExists)
            {
                dbContext.Database.ExecuteSqlRaw("ALTER TABLE UserProfiles ADD COLUMN IsPrivate INTEGER NOT NULL DEFAULT 0;");
            }

            var handleCooldownColumnExists = dbContext.Database
                .SqlQueryRaw<int>("SELECT 1 FROM pragma_table_info('UserProfiles') WHERE name = 'LastHandleChangeAtUtc'")
                .ToList()
                .Count > 0;

            if (!handleCooldownColumnExists)
            {
                dbContext.Database.ExecuteSqlRaw("ALTER TABLE UserProfiles ADD COLUMN LastHandleChangeAtUtc TEXT NULL;");
            }

            var parentCommentColumnExists = dbContext.Database
                .SqlQueryRaw<int>("SELECT 1 FROM pragma_table_info('Comments') WHERE name = 'ParentCommentId'")
                .ToList()
                .Count > 0;

            if (!parentCommentColumnExists)
            {
                dbContext.Database.ExecuteSqlRaw("ALTER TABLE Comments ADD COLUMN ParentCommentId TEXT NULL;");
            }

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_Comments_ParentCommentId ON Comments (ParentCommentId);");

            var parentReelCommentColumnExists = dbContext.Database
                .SqlQueryRaw<int>("SELECT 1 FROM pragma_table_info('ReelComments') WHERE name = 'ParentCommentId'")
                .ToList()
                .Count > 0;

            if (!parentReelCommentColumnExists)
            {
                dbContext.Database.ExecuteSqlRaw("ALTER TABLE ReelComments ADD COLUMN ParentCommentId TEXT NULL;");
            }

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_ReelComments_ParentCommentId ON ReelComments (ParentCommentId);");
        }

        if (dbContext.Database.IsMySql())
        {
            var handleCooldownColumnExists = dbContext.Database
                .SqlQueryRaw<int>("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'UserProfiles' AND COLUMN_NAME = 'LastHandleChangeAtUtc' LIMIT 1;")
                .ToList()
                .Count > 0;

            if (!handleCooldownColumnExists)
            {
                dbContext.Database.ExecuteSqlRaw("ALTER TABLE UserProfiles ADD COLUMN LastHandleChangeAtUtc datetime(6) NULL;");
            }
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Database bootstrap failed during application startup.");
        if (app.Environment.IsDevelopment())
        {
            throw;
        }
    }
}

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new { message = "An unexpected error occurred." });
    });
});

var webRoot = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var uploadsRoot = UploadsRootResolver.Resolve(app.Configuration, app.Environment);
var uploadsStaticEnabled = false;

try
{
    Directory.CreateDirectory(uploadsRoot);
    Directory.CreateDirectory(Path.Combine(uploadsRoot, "images"));
    Directory.CreateDirectory(Path.Combine(uploadsRoot, "stories"));
    uploadsStaticEnabled = true;
    app.Logger.LogInformation("Uploads root resolved to: {UploadsRoot}", uploadsRoot);
}
catch (Exception ex)
{
    app.Logger.LogError(ex, "Uploads directory initialization failed for path {UploadsRoot}. Continuing without uploads static files.", uploadsRoot);
}

app.UseCors("ClientApps");
if (uploadsStaticEnabled)
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(uploadsRoot),
        RequestPath = "/uploads"
    });
}
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");
app.Run();
