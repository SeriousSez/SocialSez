using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Identity;
using SocialSez.ApplicationService.Interfaces;
using SocialSez.ApplicationService.Services;
using SocialSez.Domain.Entities;

namespace SocialSez.ApplicationService.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddSocialSezApplication(this IServiceCollection services)
    {
        services.AddScoped<PasswordHasher<AppUser>>();
        services.AddScoped<IJwtTokenFactory, JwtTokenFactory>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IProfileService, ProfileService>();
        services.AddScoped<IPostService, PostService>();
        services.AddScoped<IChatService, ChatService>();
        services.AddScoped<IFollowService, FollowService>();
        return services;
    }
}
