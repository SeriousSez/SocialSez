using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IBlogService
{
    Task<BlogDto> CreateAsync(Guid ownerProfileId, CreateBlogRequest request, CancellationToken cancellationToken = default);
    Task<BlogDto?> UpdateAsync(Guid blogId, Guid ownerProfileId, UpdateBlogRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<BlogDto>> GetMineAsync(Guid ownerProfileId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<BlogDto>> DiscoverAsync(Guid? viewerProfileId = null, string? query = null, int take = 60, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<BlogDto>> GetFollowingAsync(Guid viewerProfileId, string? query = null, int take = 60, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<BlogDto>> GetByOwnerHandleAsync(string handle, Guid? viewerProfileId = null, CancellationToken cancellationToken = default);
    Task<BlogDto?> GetByOwnerHandleAndSlugAsync(string handle, string blogSlug, Guid? viewerProfileId = null, CancellationToken cancellationToken = default);
    Task<BlogPostDto> CreatePostAsync(Guid blogId, Guid authorProfileId, CreateBlogPostRequest request, CancellationToken cancellationToken = default);
    Task<BlogPostDto?> UpdatePostAsync(Guid blogId, Guid postId, Guid authorProfileId, UpdateBlogPostRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid blogId, Guid ownerProfileId, CancellationToken cancellationToken = default);
    Task<bool> DeletePostAsync(Guid blogId, Guid postId, Guid authorProfileId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<BlogPostDto>> GetPostsAsync(string handle, string blogSlug, Guid? viewerProfileId = null, CancellationToken cancellationToken = default);
    Task<BlogPostDto?> GetPostBySlugAsync(string handle, string blogSlug, string postSlug, Guid? viewerProfileId = null, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<BlogPostDto>> GetSavedPostsAsync(Guid profileId, int take = 50, int skip = 0, CancellationToken cancellationToken = default);
    Task<BlogPostDto?> SavePostAsync(Guid blogId, Guid postId, Guid profileId, CancellationToken cancellationToken = default);
    Task<bool> UnsavePostAsync(Guid blogId, Guid postId, Guid profileId, CancellationToken cancellationToken = default);
}
