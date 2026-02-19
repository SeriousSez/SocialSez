using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IPostService
{
    Task<PostDto> CreateAsync(CreatePostRequest request, CancellationToken cancellationToken = default);
    Task<PostDto?> UpdateAsync(Guid postId, Guid profileId, UpdatePostRequest request, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid postId, Guid profileId, CancellationToken cancellationToken = default);
    Task<PostDto?> AddCommentAsync(Guid postId, CreateCommentRequest request, CancellationToken cancellationToken = default);
    Task<PostDto?> UpdateCommentAsync(Guid postId, Guid commentId, Guid profileId, UpdateCommentRequest request, CancellationToken cancellationToken = default);
    Task<PostDto?> DeleteCommentAsync(Guid postId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default);
    Task<PostDto?> SetCommentReactionAsync(Guid postId, Guid commentId, Guid profileId, SetReactionRequest request, CancellationToken cancellationToken = default);
    Task<PostDto?> ClearCommentReactionAsync(Guid postId, Guid commentId, Guid profileId, CancellationToken cancellationToken = default);
    Task<PostDto?> ToggleLikeAsync(Guid postId, Guid profileId, CancellationToken cancellationToken = default);
    Task<PostDto?> SetReactionAsync(Guid postId, Guid profileId, SetReactionRequest request, CancellationToken cancellationToken = default);
    Task<PostDto?> ClearReactionAsync(Guid postId, Guid profileId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<PostDto>> GetFeedAsync(Guid profileId, int take = 25, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<PostDto>> SearchPostsAsync(Guid profileId, string query, int take = 25, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<HashtagSearchResultDto>> SearchHashtagsAsync(string query, int take = 20, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<PostDto>> GetByHashtagAsync(Guid profileId, string hashtag, int take = 25, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<PostDto>> GetByAuthorHandleAsync(Guid profileId, string handle, int take = 25, CancellationToken cancellationToken = default);
}
