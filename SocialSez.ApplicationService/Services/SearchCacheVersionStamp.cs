using System.Threading;

namespace SocialSez.ApplicationService.Services;

internal static class SearchCacheVersionStamp
{
    private static long blogVersion = 1;
    private static long communityVersion = 1;
    private static long postVersion = 1;
    private static long profileVersion = 1;

    public static long BlogVersion => Interlocked.Read(ref blogVersion);
    public static long CommunityVersion => Interlocked.Read(ref communityVersion);
    public static long PostVersion => Interlocked.Read(ref postVersion);
    public static long ProfileVersion => Interlocked.Read(ref profileVersion);

    public static void BumpBlog() => Interlocked.Increment(ref blogVersion);
    public static void BumpCommunity() => Interlocked.Increment(ref communityVersion);
    public static void BumpPost() => Interlocked.Increment(ref postVersion);
    public static void BumpProfile() => Interlocked.Increment(ref profileVersion);
}