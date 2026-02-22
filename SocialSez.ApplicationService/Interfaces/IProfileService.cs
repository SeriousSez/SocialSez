using SocialSez.ApplicationService.Models;

namespace SocialSez.ApplicationService.Interfaces;

public interface IProfileService
{
    Task<ProfileDto> CreateAsync(CreateProfileRequest request, CancellationToken cancellationToken = default);
    Task<ProfileDto?> GetByIdAsync(Guid profileId, CancellationToken cancellationToken = default);
    Task<ProfileDto?> GetByHandleAsync(string handle, Guid? viewerId = null, CancellationToken cancellationToken = default);
    Task<ProfileActivitySummaryDto?> GetActivitySummaryByHandleAsync(string handle, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<ProfileDto>> SearchAsync(string query, Guid? viewerId = null, int take = 20, CancellationToken cancellationToken = default);
    Task<ProfileDto?> UpdateAsync(Guid profileId, UpdateProfileRequest request, CancellationToken cancellationToken = default);
    Task<ProfileDto?> UpdatePrivacyAsync(Guid profileId, UpdateProfilePrivacyRequest request, CancellationToken cancellationToken = default);
}
