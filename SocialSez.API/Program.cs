using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SocialSez.ApplicationService.Extensions;
using SocialSez.Infrastructure.Extensions;
using SocialSez.Infrastructure;

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

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddCors(options =>
{
    options.AddPolicy("ClientApps", policy =>
    {
        policy.WithOrigins("http://localhost:4200")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "SocialSez";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "SocialSez.Clients";
var jwtKey = builder.Configuration["Jwt:Key"] ?? throw new InvalidOperationException("Missing Jwt:Key configuration.");

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

app.UseCors("ClientApps");
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
