using System.ComponentModel.DataAnnotations;

namespace Eshopper.Api.Domain;

public class PushSubscription
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public Guid? AppSessionId { get; set; }
    [MaxLength(2048)] public string Endpoint { get; set; } = "";
    [MaxLength(64)] public string EndpointHash { get; set; } = "";
    [MaxLength(87)] public string P256dh { get; set; } = "";
    [MaxLength(22)] public string Auth { get; set; } = "";
    public int LastActivityId { get; set; }
    // Persist the in-flight batch before sending. Failed/restarted workers never skip it.
    public int? PendingThroughId { get; set; }
    public int PendingCount { get; set; }
    public int FailureCount { get; set; }
    public bool Suspended { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public DateTime? LeaseUntil { get; set; }
    [ConcurrencyCheck, MaxLength(32)] public string Version { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
