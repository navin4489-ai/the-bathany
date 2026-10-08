using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Eshopper.Api.Infrastructure;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.EntityFrameworkCore;
using StoredSubscription = Eshopper.Api.Domain.PushSubscription;

namespace Eshopper.Api.Services;

public sealed class AdminPushOptions
{
    public string PublicKey { get; private init; } = "";
    internal string PrivateKey { get; private init; } = "";
    internal string Subject { get; private init; } = "";
    public bool Enabled { get; private init; }

    public static AdminPushOptions FromEnvironment()
    {
        var publicKey = Environment.GetEnvironmentVariable("VAPID_PUBLIC_KEY") ?? "";
        var privateKey = Environment.GetEnvironmentVariable("VAPID_PRIVATE_KEY") ?? "";
        var subject = Environment.GetEnvironmentVariable("VAPID_SUBJECT") ?? "";
        var enabled = false;
        try
        {
            var point = PushValidation.DecodeKey(publicKey, 65);
            var secret = PushValidation.DecodeKey(privateKey, 32);
            using var key = ECDsa.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = point[1..33], Y = point[33..65] },
                D = secret
            });
            // Confirm both configured keys form the same pair without exposing them.
            using var verifier = ECDsa.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = point[1..33], Y = point[33..65] }
            });
            var probe = new byte[] { 1, 2, 3 };
            enabled = point[0] == 4 && verifier.VerifyData(probe, key.SignData(probe, HashAlgorithmName.SHA256), HashAlgorithmName.SHA256)
                && Uri.TryCreate(subject, UriKind.Absolute, out var uri)
                && (uri.Scheme == "mailto" || uri.Scheme == "https")
                && !subject.Any(c => char.IsControl(c) || c == '"' || c == '\\');
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or CryptographicException) { enabled = false; }
        return new AdminPushOptions { PublicKey = publicKey, PrivateKey = privateKey, Subject = subject, Enabled = enabled };
    }
}

public static class PushValidation
{
    public static async Task<bool> IsAuthorizedRecipientAsync(ShopDbContext db, int userId, Guid? appSessionId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => new { u.Role, u.PasswordHash }).SingleOrDefaultAsync(ct);
        if (user is null || user.Role != "Admin") return false;
        if (appSessionId is null) return true;
        var session = await db.Set<Eshopper.Api.Domain.AppSession>().AsNoTracking()
            .SingleOrDefaultAsync(s => s.Id == appSessionId && s.UserId == userId && s.RevokedAt == null, ct);
        return session is not null && session.PasswordStamp == AppSessionService.PasswordStamp(user.PasswordHash);
    }

    public static bool IsAllowedEndpoint(string? endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint) || endpoint.Length > 2048 ||
            endpoint.Any(char.IsControl) || endpoint.Contains('\\') ||
            !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || uri.Port != 443 || uri.UserInfo.Length != 0 ||
            uri.Fragment.Length != 0 || uri.HostNameType != UriHostNameType.Dns)
            return false;
        var host = uri.IdnHost.ToLowerInvariant();
        return host == "fcm.googleapis.com"
            || host == "updates.push.services.mozilla.com"
            || host.EndsWith(".push.services.mozilla.com", StringComparison.Ordinal)
            || host == "web.push.apple.com"
            || host.EndsWith(".push.apple.com", StringComparison.Ordinal)
            || host.EndsWith(".notify.windows.com", StringComparison.Ordinal);
    }

    public static byte[] DecodeKey(string? value, int length)
    {
        if (value is null || value.Length != (length * 8 + 5) / 6 ||
            value.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_')))
            throw new FormatException("Invalid push key.");
        var decoded = Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/') + new string('=', (4 - value.Length % 4) % 4));
        if (decoded.Length != length) throw new FormatException("Invalid push key.");
        return decoded;
    }

    public static bool AreValidKeys(string? p256dh, string? auth)
    {
        try
        {
            var point = DecodeKey(p256dh, 65);
            _ = DecodeKey(auth, 16);
            if (point[0] != 4) return false;
            using var key = ECDiffieHellman.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = point[1..33], Y = point[33..65] }
            });
            return true;
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException or CryptographicException) { return false; }
    }

    public static string EndpointHash(string endpoint) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(endpoint)));
}

public sealed class AdminPushService(
    IServiceScopeFactory scopes,
    AdminPushOptions options,
    ILogger<AdminPushService> logger) : BackgroundService
{
    private const int BatchSize = 100;
    private const int MaxFailures = 6;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            logger.LogWarning("Admin Web Push disabled: VAPID environment configuration is missing or invalid.");
            return;
        }
        // No redirects: an allowed push provider must never redirect into internal infrastructure.
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
        { Timeout = TimeSpan.FromSeconds(15) };
        using var authentication = new VapidAuthentication(options.PublicKey, options.PrivateKey) { Subject = options.Subject };
        var client = new PushServiceClient(http) { DefaultAuthentication = authentication, AutoRetryAfter = false };

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ShopDbContext>();
                var now = DateTime.UtcNow;
                var ids = await db.Set<StoredSubscription>().AsNoTracking()
                    .Where(s => !s.Suspended && s.NextAttemptAt <= now && (s.LeaseUntil == null || s.LeaseUntil <= now))
                    .OrderBy(s => s.NextAttemptAt).Select(s => s.Id).Take(50).ToListAsync(stoppingToken);
                foreach (var id in ids)
                {
                    try { await DeliverAsync(id, client, stoppingToken); }
                    catch (DbUpdateConcurrencyException) { /* Another worker or unsubscribe won the lease. */ }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                    catch (Exception ex)
                    {
                        // Provider exceptions may contain endpoint tokens: never log their message/body.
                        logger.LogError("Admin push processing failed for subscription {Id}: {ErrorType}", id, ex.GetType().Name);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogError("Admin push scan failed: {ErrorType}", ex.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
        }
    }

    private async Task DeliverAsync(int id, PushServiceClient client, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ShopDbContext>();
        var row = await db.Set<StoredSubscription>().SingleOrDefaultAsync(s => s.Id == id, ct);
        if (row is null || row.Suspended || row.NextAttemptAt > DateTime.UtcNow || row.LeaseUntil > DateTime.UtcNow) return;
        if (!await PushValidation.IsAuthorizedRecipientAsync(db, row.UserId, row.AppSessionId, ct)
            || !PushValidation.IsAllowedEndpoint(row.Endpoint) || !PushValidation.AreValidKeys(row.P256dh, row.Auth))
        {
            db.Remove(row);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Removed invalid, signed-out, or non-admin push subscription {Id}", id);
            return;
        }
        row.LeaseUntil = DateTime.UtcNow.AddMinutes(1);
        row.Version = Guid.NewGuid().ToString("N");
        await db.SaveChangesAsync(ct);
        if (row.PendingThroughId is null)
        {
            var batch = await db.AuditActivities.AsNoTracking().Where(a => a.Id > row.LastActivityId)
                .OrderBy(a => a.Id).Select(a => a.Id).Take(BatchSize).ToListAsync(ct);
            if (batch.Count == 0)
            {
                row.LeaseUntil = null;
                row.NextAttemptAt = DateTime.UtcNow.AddSeconds(10);
                await db.SaveChangesAsync(ct);
                return;
            }
            row.PendingThroughId = batch[^1];
            row.PendingCount = batch.Count;
            await db.SaveChangesAsync(ct);
        }

        // Recheck current role/session/password immediately before the outbound request.
        if (!await PushValidation.IsAuthorizedRecipientAsync(db, row.UserId, row.AppSessionId, ct))
        {
            db.Remove(row);
            await db.SaveChangesAsync(ct);
            return;
        }
        var payload = JsonSerializer.Serialize(new
        {
            notification = new
            {
                title = "Store activity",
                body = $"{row.PendingCount} new store activities. Open the admin dashboard to review.",
                tag = $"admin-activity-{row.PendingThroughId}",
                data = new
                {
                    onActionClick = new { @default = new { operation = "openWindow", url = "/admin" } }
                }
            }
        });
        try
        {
            await client.RequestPushMessageDeliveryAsync(new Lib.Net.Http.WebPush.PushSubscription
            {
                Endpoint = row.Endpoint,
                Keys = new Dictionary<string, string> { ["p256dh"] = row.P256dh, ["auth"] = row.Auth }
            }, new PushMessage(payload) { TimeToLive = 86400 }, ct);
            row.LastActivityId = row.PendingThroughId!.Value;
            row.PendingThroughId = null;
            row.PendingCount = 0;
            row.FailureCount = 0;
            row.NextAttemptAt = DateTime.UtcNow.AddSeconds(30);
            logger.LogInformation("Admin push accepted for subscription {Id}; cursor {Cursor}", id, row.LastActivityId);
        }
        catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            db.Remove(row);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Pruned expired push subscription {Id}", id);
            return;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            row.FailureCount++;
            row.Suspended = row.FailureCount >= MaxFailures;
            var delay = TimeSpan.FromSeconds(Math.Min(3600, 30 * Math.Pow(2, row.FailureCount - 1)));
            if (ex is PushServiceClientException provider && provider.Headers?.RetryAfter is { } retry)
            {
                var requested = retry.Delta ?? (retry.Date - DateTimeOffset.UtcNow);
                if (requested > delay) delay = TimeSpan.FromSeconds(Math.Min(86400, requested.Value.TotalSeconds));
            }
            row.NextAttemptAt = DateTime.UtcNow.Add(delay);
            logger.LogWarning("Admin push failure for subscription {Id}: type {Type}, status {Status}, attempt {Attempt}/{Max}, suspended {Suspended}, retry {Next}. Pending batch retained; re-enable to resume.",
                id, ex.GetType().Name, ex is PushServiceClientException p ? (int)p.StatusCode : 0,
                row.FailureCount, MaxFailures, row.Suspended, row.NextAttemptAt);
        }
        row.LeaseUntil = null;
        row.Version = Guid.NewGuid().ToString("N");
        await db.SaveChangesAsync(ct);
    }
}
