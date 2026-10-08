using System.ComponentModel.DataAnnotations;

namespace Eshopper.Api.Domain;

public class AppSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int UserId { get; set; }
    public User? User { get; set; }
    [MaxLength(64)] public string TokenHash { get; set; } = "";
    [MaxLength(64)] public string PasswordStamp { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastRenewedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAt { get; set; }
}
