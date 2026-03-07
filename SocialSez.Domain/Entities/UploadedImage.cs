namespace SocialSez.Domain.Entities;

public class UploadedImage
{
    public Guid Id { get; set; }
    public Guid UploadedByProfileId { get; set; }
    public string ContentType { get; set; } = string.Empty;
    public string OriginalFileName { get; set; } = string.Empty;
    public string FileExtension { get; set; } = string.Empty;
    public byte[] Content { get; set; } = Array.Empty<byte>();
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public UserProfile UploadedByProfile { get; set; } = null!;
}
