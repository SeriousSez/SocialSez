using Microsoft.Extensions.Caching.Memory;

namespace SocialSez.ApplicationService.Services;

internal static class SearchResultCache
{
    public static Task<T> GetOrCreateAsync<T>(
        IMemoryCache cache,
        string key,
        TimeSpan ttl,
        Func<Task<T>> factory)
        where T : class
    {
        if (cache.TryGetValue(key, out T? cached) && cached is not null)
        {
            return Task.FromResult(cached);
        }

        return CreateAndCacheAsync(cache, key, ttl, factory);
    }

    private static async Task<T> CreateAndCacheAsync<T>(
        IMemoryCache cache,
        string key,
        TimeSpan ttl,
        Func<Task<T>> factory)
        where T : class
    {
        var created = await factory();
        cache.Set(key, created, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = ttl
        });

        return created;
    }
}
