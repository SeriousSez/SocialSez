using System.Text;
using System.Net;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SocialSez.API.Hubs;
using SocialSez.ApplicationService.Interfaces;
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
builder.Services.AddMemoryCache();
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

var configuredPublicAppOrigin = builder.Configuration["PublicAppOrigin"]?.Trim();
var inferredPublicAppOrigin = allowedCorsOrigins.FirstOrDefault(origin => !origin.Contains(".api.", StringComparison.OrdinalIgnoreCase));
var publicAppOrigin = !string.IsNullOrWhiteSpace(configuredPublicAppOrigin)
    ? configuredPublicAppOrigin
    : inferredPublicAppOrigin;

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

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UserBlocks (
                BlockerId TEXT NOT NULL,
                BlockedId TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (BlockerId, BlockedId),
                FOREIGN KEY (BlockerId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT,
                FOREIGN KEY (BlockedId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_UserBlocks_BlockedId
            ON UserBlocks (BlockedId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UserMutes (
                MuterId TEXT NOT NULL,
                MutedId TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (MuterId, MutedId),
                FOREIGN KEY (MuterId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT,
                FOREIGN KEY (MutedId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_UserMutes_MutedId
            ON UserMutes (MutedId);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UserReports (
                Id TEXT NOT NULL PRIMARY KEY,
                ReporterId TEXT NOT NULL,
                TargetProfileId TEXT NOT NULL,
                Reason TEXT NOT NULL,
                Details TEXT NULL,
                Status TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (ReporterId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT,
                FOREIGN KEY (TargetProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_UserReports_TargetProfileId_CreatedAtUtc
            ON UserReports (TargetProfileId, CreatedAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE INDEX IF NOT EXISTS IX_UserReports_ReporterId_CreatedAtUtc
            ON UserReports (ReporterId, CreatedAtUtc);
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS Communities (
                Id TEXT NOT NULL PRIMARY KEY,
                CreatedByProfileId TEXT NOT NULL,
                Slug TEXT NOT NULL,
                Name TEXT NOT NULL,
                Description TEXT NULL,
                ImageUrl TEXT NULL,
                IsPrivate INTEGER NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (CreatedByProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_Communities_Slug ON Communities (Slug);");
            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_Communities_CreatedAtUtc ON Communities (CreatedAtUtc);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommunityMembers (
                CommunityId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                Role TEXT NOT NULL,
                JoinedAtUtc TEXT NOT NULL,
                PRIMARY KEY (CommunityId, ProfileId),
                FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityMembers_ProfileId ON CommunityMembers (ProfileId);");
            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityMembers_CommunityId_Role ON CommunityMembers (CommunityId, Role);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommunityPosts (
                Id TEXT NOT NULL PRIMARY KEY,
                CommunityId TEXT NOT NULL,
                AuthorId TEXT NOT NULL,
                Content TEXT NULL,
                ImageUrl TEXT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (CommunityId) REFERENCES Communities (Id) ON DELETE CASCADE,
                FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityPosts_CommunityId_CreatedAtUtc ON CommunityPosts (CommunityId, CreatedAtUtc);");
            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityPosts_AuthorId ON CommunityPosts (AuthorId);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommunityPostComments (
                Id TEXT NOT NULL PRIMARY KEY,
                PostId TEXT NOT NULL,
                AuthorId TEXT NOT NULL,
                Content TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE,
                FOREIGN KEY (AuthorId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityPostComments_PostId_CreatedAtUtc ON CommunityPostComments (PostId, CreatedAtUtc);");
            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityPostComments_AuthorId ON CommunityPostComments (AuthorId);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommunityPolls (
                Id TEXT NOT NULL PRIMARY KEY,
                PostId TEXT NOT NULL,
                Question TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_CommunityPolls_PostId ON CommunityPolls (PostId);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommunityPollOptions (
                Id TEXT NOT NULL PRIMARY KEY,
                PollId TEXT NOT NULL,
                Text TEXT NOT NULL,
                FOREIGN KEY (PollId) REFERENCES CommunityPolls (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityPollOptions_PollId ON CommunityPollOptions (PollId);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommunityPollVotes (
                OptionId TEXT NOT NULL,
                VoterId TEXT NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                PRIMARY KEY (OptionId, VoterId),
                FOREIGN KEY (OptionId) REFERENCES CommunityPollOptions (Id) ON DELETE CASCADE,
                FOREIGN KEY (VoterId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunityPollVotes_VoterId ON CommunityPollVotes (VoterId);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CommunitySavedPosts (
                PostId TEXT NOT NULL,
                ProfileId TEXT NOT NULL,
                SavedAtUtc TEXT NOT NULL,
                PRIMARY KEY (PostId, ProfileId),
                FOREIGN KEY (PostId) REFERENCES CommunityPosts (Id) ON DELETE CASCADE,
                FOREIGN KEY (ProfileId) REFERENCES UserProfiles (Id) ON DELETE CASCADE
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunitySavedPosts_ProfileId ON CommunitySavedPosts (ProfileId);");
            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_CommunitySavedPosts_ProfileId_SavedAtUtc ON CommunitySavedPosts (ProfileId, SavedAtUtc);");

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UploadedImages (
                Id TEXT NOT NULL PRIMARY KEY,
                UploadedByProfileId TEXT NOT NULL,
                ContentType TEXT NOT NULL,
                OriginalFileName TEXT NOT NULL,
                FileExtension TEXT NOT NULL,
                Content BLOB NOT NULL,
                CreatedAtUtc TEXT NOT NULL,
                FOREIGN KEY (UploadedByProfileId) REFERENCES UserProfiles (Id) ON DELETE RESTRICT
            );
            """);

            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_UploadedImages_CreatedAtUtc ON UploadedImages (CreatedAtUtc);");
            dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_UploadedImages_UploadedByProfileId ON UploadedImages (UploadedByProfileId);");

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
            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UserBlocks (
                BlockerId char(36) NOT NULL,
                BlockedId char(36) NOT NULL,
                CreatedAtUtc datetime(6) NOT NULL,
                PRIMARY KEY (BlockerId, BlockedId),
                KEY IX_UserBlocks_BlockedId (BlockedId)
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UserMutes (
                MuterId char(36) NOT NULL,
                MutedId char(36) NOT NULL,
                CreatedAtUtc datetime(6) NOT NULL,
                PRIMARY KEY (MuterId, MutedId),
                KEY IX_UserMutes_MutedId (MutedId)
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UserReports (
                Id char(36) NOT NULL,
                ReporterId char(36) NOT NULL,
                TargetProfileId char(36) NOT NULL,
                Reason varchar(100) NOT NULL,
                Details varchar(1000) NULL,
                Status varchar(24) NOT NULL,
                CreatedAtUtc datetime(6) NOT NULL,
                PRIMARY KEY (Id),
                KEY IX_UserReports_TargetProfileId_CreatedAtUtc (TargetProfileId, CreatedAtUtc),
                KEY IX_UserReports_ReporterId_CreatedAtUtc (ReporterId, CreatedAtUtc)
            );
            """);

            dbContext.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS UploadedImages (
                Id char(36) NOT NULL,
                UploadedByProfileId char(36) NOT NULL,
                ContentType varchar(120) NOT NULL,
                OriginalFileName varchar(260) NOT NULL,
                FileExtension varchar(16) NOT NULL,
                Content longblob NOT NULL,
                CreatedAtUtc datetime(6) NOT NULL,
                PRIMARY KEY (Id),
                KEY IX_UploadedImages_CreatedAtUtc (CreatedAtUtc),
                KEY IX_UploadedImages_UploadedByProfileId (UploadedByProfileId)
            );
            """);

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

app.MapGet("/api/unfurl/{**targetPath}", async (
    HttpContext context,
    string targetPath,
    IPostService postService,
    ICommunityService communityService,
    IReelService reelService,
    IStoryService storyService,
    IProfileService profileService,
    IBlogService blogService) =>
{
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var normalizedTargetPath = string.IsNullOrWhiteSpace(targetPath)
        ? "/"
        : $"/{targetPath.TrimStart('/')}";
    var meta = await ResolveUnfurlMetaAsync(normalizedTargetPath, context, publicAppOrigin, postService, communityService, reelService, storyService, profileService, blogService, context.RequestAborted);
    var targetUrl = ToAppUrl(context, publicAppOrigin, normalizedTargetPath);
    var html = BuildUnfurlRedirectHtml(BuildMetaTags(meta, targetUrl), targetUrl);

    context.Response.ContentType = "text/html; charset=utf-8";
    if (!HttpMethods.IsHead(context.Request.Method))
    {
        await context.Response.WriteAsync(html, context.RequestAborted);
    }
});

app.MapGet("/api/unfurl/image", (HttpContext context) =>
{
    var safeTitle = Truncate(context.Request.Query["title"], 90);
    var safeSubtitle = Truncate(context.Request.Query["subtitle"], 120);
    var safeAccent = context.Request.Query.TryGetValue("accent", out var accentValue) && !string.IsNullOrWhiteSpace(accentValue)
        ? accentValue.ToString().Trim()
        : "#2563eb";

    var svg = $"""
<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"630\" viewBox=\"0 0 1200 630\" role=\"img\" aria-label=\"{XmlEscape(safeTitle)}\">
    <defs>
        <linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">
            <stop offset=\"0%\" stop-color=\"#0f172a\"/>
            <stop offset=\"100%\" stop-color=\"#1e293b\"/>
        </linearGradient>
        <linearGradient id=\"accent\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\">
            <stop offset=\"0%\" stop-color=\"{XmlEscape(safeAccent)}\"/>
            <stop offset=\"100%\" stop-color=\"#22d3ee\"/>
        </linearGradient>
    </defs>

    <rect width=\"1200\" height=\"630\" fill=\"url(#bg)\"/>
    <rect x=\"56\" y=\"64\" width=\"10\" height=\"502\" rx=\"5\" fill=\"url(#accent)\"/>

    <text x=\"92\" y=\"190\" fill=\"#e2e8f0\" font-family=\"Segoe UI, Arial, sans-serif\" font-size=\"58\" font-weight=\"800\">{XmlEscape(string.IsNullOrWhiteSpace(safeTitle) ? "Venli" : safeTitle)}</text>
    <text x=\"92\" y=\"260\" fill=\"#94a3b8\" font-family=\"Segoe UI, Arial, sans-serif\" font-size=\"34\" font-weight=\"500\">{XmlEscape(string.IsNullOrWhiteSpace(safeSubtitle) ? "Community Platform" : safeSubtitle)}</text>

    <text x=\"92\" y=\"542\" fill=\"#cbd5e1\" font-family=\"Segoe UI, Arial, sans-serif\" font-size=\"30\" font-weight=\"700\">venli.sezginsahin.dk</text>
</svg>
""";

    context.Response.Headers.CacheControl = "public,max-age=86400";
    return Results.Text(svg, "image/svg+xml");
});

var spaIndexPath = Path.Combine(webRoot, "index.html");

app.MapFallback(async (
    HttpContext context,
    IPostService postService,
    ICommunityService communityService,
    IReelService reelService,
    IStoryService storyService,
    IProfileService profileService,
    IBlogService blogService,
    IMemoryCache memoryCache) =>
{
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var path = context.Request.Path.Value ?? "/";
    if (path.StartsWith("/api", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/hubs", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/uploads", StringComparison.OrdinalIgnoreCase)
        || Path.HasExtension(path))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    if (!File.Exists(spaIndexPath))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var indexHtml = await memoryCache.GetOrCreateAsync($"spa-index-html::{spaIndexPath}", async entry =>
    {
        entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
        return await File.ReadAllTextAsync(spaIndexPath, context.RequestAborted);
    }) ?? string.Empty;

    var meta = await ResolveUnfurlMetaAsync(path, context, publicAppOrigin, postService, communityService, reelService, storyService, profileService, blogService, context.RequestAborted);
    var responseHtml = InjectMetaTags(indexHtml, BuildMetaTags(meta, ToAppUrl(context, publicAppOrigin, path)));

    context.Response.ContentType = "text/html; charset=utf-8";
    if (!HttpMethods.IsHead(context.Request.Method))
    {
        await context.Response.WriteAsync(responseHtml, context.RequestAborted);
    }
});

app.Run();

static async Task<UnfurlMeta> ResolveUnfurlMetaAsync(
    string path,
    HttpContext context,
    string? publicAppOrigin,
    IPostService postService,
    ICommunityService communityService,
    IReelService reelService,
    IStoryService storyService,
    IProfileService profileService,
    IBlogService blogService,
    CancellationToken cancellationToken)
{
    var defaultMeta = new UnfurlMeta(
        "Venli",
        "Build, post, discover and follow in one flow.",
        ToAbsoluteUrl(context, "/assets/images/v-blue-close.png", publicAppOrigin),
        "website");

    var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
    if (segments.Length == 0)
    {
        return defaultMeta;
    }

    try
    {
        if (segments.Length >= 2 && segments[0].Equals("post", StringComparison.OrdinalIgnoreCase) && Guid.TryParse(segments[1], out var postId))
        {
            var post = await postService.GetPublicByIdAsync(postId, null, cancellationToken);
            if (post is null)
            {
                return defaultMeta;
            }

            return new UnfurlMeta(
                $"@{post.AuthorHandle} on Venli",
                Truncate(post.Content, 200) ?? "Shared post on Venli.",
                ToAbsoluteUrl(context, post.ImageUrls.FirstOrDefault() ?? post.ImageUrl ?? post.AuthorImageUrl, publicAppOrigin),
                "article");
        }

        if (segments.Length >= 2 && segments[0].Equals("cp", StringComparison.OrdinalIgnoreCase) && Guid.TryParse(segments[1], out var communityPostId))
        {
            var communityPost = await communityService.GetPostByIdAsync(communityPostId, null, cancellationToken);
            if (communityPost is null)
            {
                return defaultMeta;
            }

            var title = Truncate(communityPost.Title ?? communityPost.Content ?? communityPost.MediaContent, 160)
                ?? $"Community post by @{communityPost.AuthorHandle}";
            var description = Truncate(communityPost.Content ?? communityPost.MediaContent ?? communityPost.LinkUrl, 220)
                ?? "Shared community post on Venli.";
            var generatedImage = BuildUnfurlImageUrl(
                context,
                publicAppOrigin,
                title,
                $"@{communityPost.AuthorHandle} in community",
                "#0ea5e9");

            return new UnfurlMeta(
                title,
                description,
                generatedImage,
                "article");
        }

        if (segments.Length >= 2 && segments[0].Equals("reel", StringComparison.OrdinalIgnoreCase) && Guid.TryParse(segments[1], out var reelId))
        {
            var reel = await reelService.GetPublicByIdAsync(reelId, null, cancellationToken);
            if (reel is null)
            {
                return defaultMeta;
            }

            return new UnfurlMeta(
                $"Reel by @{reel.AuthorHandle}",
                Truncate(reel.Caption, 220) ?? "Watch this reel on Venli.",
                ToAbsoluteUrl(context, reel.ThumbnailUrl ?? reel.AuthorImageUrl, publicAppOrigin),
                "video.other");
        }

        if (segments.Length >= 2 && segments[0].Equals("story", StringComparison.OrdinalIgnoreCase) && Guid.TryParse(segments[1], out var storyId))
        {
            var story = await storyService.GetPublicByIdAsync(storyId, null, cancellationToken);
            if (story is null)
            {
                return defaultMeta;
            }

            return new UnfurlMeta(
                $"Story by @{story.AuthorHandle}",
                Truncate(story.Caption, 220) ?? "View this story on Venli.",
                ToAbsoluteUrl(context, story.MediaUrl ?? story.AuthorImageUrl, publicAppOrigin),
                "article");
        }

        if (segments.Length >= 2 && segments[0].Equals("users", StringComparison.OrdinalIgnoreCase))
        {
            var handle = segments[1].Trim();
            var profile = await profileService.GetByHandleAsync(handle, null, cancellationToken);
            if (profile is null)
            {
                return defaultMeta;
            }

            var displayName = string.IsNullOrWhiteSpace(profile.DisplayName) ? profile.Handle : profile.DisplayName;
            return new UnfurlMeta(
                $"{displayName} (@{profile.Handle}) | Venli",
                Truncate(profile.Bio, 220) ?? $"View @{profile.Handle}'s profile on Venli.",
                ToAbsoluteUrl(context, profile.ImageUrl, publicAppOrigin),
                "profile");
        }

        if (segments.Length >= 2 && segments[0].Equals("c", StringComparison.OrdinalIgnoreCase))
        {
            var slug = segments[1].Trim();
            var community = await communityService.GetBySlugAsync(slug, null, 20, cancellationToken);
            if (community is null)
            {
                return defaultMeta;
            }

            return new UnfurlMeta(
                $"{community.Name} | Venli Community",
                Truncate(community.Description, 220) ?? $"Join {community.Name} on Venli.",
                ToAbsoluteUrl(context, community.ImageUrl, publicAppOrigin),
                "website");
        }

        if (segments.Length >= 2 && segments[0].Equals("blogs", StringComparison.OrdinalIgnoreCase))
        {
            var handle = segments[1].Trim();
            if (handle.Equals("studio", StringComparison.OrdinalIgnoreCase))
            {
                return defaultMeta;
            }

            if (segments.Length >= 4)
            {
                var post = await blogService.GetPostBySlugAsync(handle, segments[2], segments[3], null, cancellationToken);
                if (post is not null)
                {
                    var title = $"{post.Title} | @{post.AuthorHandle}";
                    var description = Truncate(post.Excerpt ?? post.Content, 220) ?? "Read this blog post on Venli.";
                    var mediaImage = ToAbsoluteUrl(context, post.CoverImageUrl, publicAppOrigin);
                    var image = string.IsNullOrWhiteSpace(mediaImage)
                        ? BuildUnfurlImageUrl(context, publicAppOrigin, post.Title, $"@{post.AuthorHandle} on Venli", "#22c55e")
                        : mediaImage;

                    return new UnfurlMeta(
                        title,
                        description,
                        image,
                        "article");
                }
            }

            if (segments.Length >= 3)
            {
                var blog = await blogService.GetByOwnerHandleAndSlugAsync(handle, segments[2], null, cancellationToken);
                if (blog is not null)
                {
                    return new UnfurlMeta(
                        $"{blog.Title} | @{blog.OwnerHandle}",
                        Truncate(blog.Description, 220) ?? $"Read @{blog.OwnerHandle}'s blog on Venli.",
                        ToAbsoluteUrl(context, null),
                        "website");
                }
            }

            return new UnfurlMeta(
                $"@{handle} blogs | Venli",
                $"Read and follow @{handle} on Venli.",
                defaultMeta.ImageUrl,
                "website");
        }
    }
    catch
    {
        // Keep default metadata when unfurl lookups fail.
    }

    return defaultMeta;
}

static string Truncate(string? value, int maxLength)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        return string.Empty;
    }

    var normalized = string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    if (normalized.Length <= maxLength)
    {
        return normalized;
    }

    return $"{normalized[..Math.Max(0, maxLength - 1)].TrimEnd()}...";
}

static string ToAbsoluteUrl(HttpContext context, string? value, string? publicAppOrigin = null)
{
    var defaultPath = "/assets/images/v-blue-close.png";
    var normalized = string.IsNullOrWhiteSpace(value) ? defaultPath : value.Trim();

    if (Uri.TryCreate(normalized, UriKind.Absolute, out var absoluteUri))
    {
        if (absoluteUri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || absoluteUri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || absoluteUri.Host.Equals("0.0.0.0", StringComparison.OrdinalIgnoreCase))
        {
            var rewrittenPath = absoluteUri.PathAndQuery;
            if (rewrittenPath.StartsWith("/api/uploads/", StringComparison.OrdinalIgnoreCase))
            {
                rewrittenPath = rewrittenPath[4..];
            }

            return $"{context.Request.Scheme}://{context.Request.Host}{rewrittenPath}";
        }

        return absoluteUri.ToString();
    }

    if (!normalized.StartsWith('/'))
    {
        normalized = $"/{normalized}";
    }

    if (!string.IsNullOrWhiteSpace(publicAppOrigin)
        && normalized.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase))
    {
        return $"{publicAppOrigin.TrimEnd('/')}{normalized}";
    }

    return $"{context.Request.Scheme}://{context.Request.Host}{normalized}";
}

static string ToAppUrl(HttpContext context, string? appOrigin, string path)
{
    var normalizedPath = string.IsNullOrWhiteSpace(path)
        ? "/"
        : (path.StartsWith('/') ? path : $"/{path}");

    if (!string.IsNullOrWhiteSpace(appOrigin))
    {
        return $"{appOrigin.TrimEnd('/')}{normalizedPath}";
    }

    var host = context.Request.Host.Host;
    if (host.Contains(".api.", StringComparison.OrdinalIgnoreCase))
    {
        host = host.Replace(".api.", ".", StringComparison.OrdinalIgnoreCase);
    }

    return $"{context.Request.Scheme}://{host}{normalizedPath}";
}

static string BuildMetaTags(UnfurlMeta meta, string pageUrl)
{
    var title = WebUtility.HtmlEncode(meta.Title);
    var description = WebUtility.HtmlEncode(meta.Description);
    var imageUrl = WebUtility.HtmlEncode(meta.ImageUrl);
    var type = WebUtility.HtmlEncode(meta.Type);

    var builder = new StringBuilder();
    builder.AppendLine($"<title>{title}</title>");
    builder.AppendLine($"<meta name=\"description\" content=\"{description}\">\n<meta property=\"og:site_name\" content=\"Venli\">\n<meta property=\"og:type\" content=\"{type}\">\n<meta property=\"og:title\" content=\"{title}\">\n<meta property=\"og:description\" content=\"{description}\">\n<meta property=\"og:url\" content=\"{WebUtility.HtmlEncode(pageUrl)}\">\n<meta property=\"og:image\" content=\"{imageUrl}\">\n<meta name=\"twitter:card\" content=\"summary_large_image\">\n<meta name=\"twitter:title\" content=\"{title}\">\n<meta name=\"twitter:description\" content=\"{description}\">\n<meta name=\"twitter:image\" content=\"{imageUrl}\">\n<meta name=\"twitter:url\" content=\"{WebUtility.HtmlEncode(pageUrl)}\">");
    return builder.ToString();
}

static string BuildUnfurlRedirectHtml(string metaTags, string targetUrl)
{
    var escapedTargetUrl = WebUtility.HtmlEncode(targetUrl);
    return $"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">{metaTags}<meta name=\"robots\" content=\"noindex, nofollow\"><link rel=\"canonical\" href=\"{escapedTargetUrl}\"><meta http-equiv=\"refresh\" content=\"0; url={escapedTargetUrl}\"><script>window.location.replace({System.Text.Json.JsonSerializer.Serialize(targetUrl)});</script></head><body><a href=\"{escapedTargetUrl}\">Continue</a></body></html>";
}

static string BuildUnfurlImageUrl(HttpContext context, string? publicAppOrigin, string title, string subtitle, string accent = "#2563eb")
{
    var origin = !string.IsNullOrWhiteSpace(publicAppOrigin)
        ? publicAppOrigin.TrimEnd('/')
        : $"{context.Request.Scheme}://{context.Request.Host}";

    var query = $"title={Uri.EscapeDataString(title)}&subtitle={Uri.EscapeDataString(subtitle)}&accent={Uri.EscapeDataString(accent)}";
    return $"{origin}/api/unfurl/image?{query}";
}

static string XmlEscape(string? value)
{
    return WebUtility.HtmlEncode(value ?? string.Empty);
}

static string InjectMetaTags(string html, string tags)
{
    if (string.IsNullOrWhiteSpace(html) || string.IsNullOrWhiteSpace(tags))
    {
        return html;
    }

    var headStart = html.IndexOf("<head", StringComparison.OrdinalIgnoreCase);
    if (headStart < 0)
    {
        return $"{tags}\n{html}";
    }

    var headEnd = html.IndexOf('>', headStart);
    if (headEnd < 0)
    {
        return $"{tags}\n{html}";
    }

    return string.Concat(html.AsSpan(0, headEnd + 1), "\n", tags, html.AsSpan(headEnd + 1));
}

sealed record UnfurlMeta(string Title, string Description, string ImageUrl, string Type);
