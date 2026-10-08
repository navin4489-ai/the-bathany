using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Eshopper.Api.Services;

public class AppSessionService(ShopDbContext db)
{
    public const string ClaimName = "sid";
    public const string CookieName = "eshopper.app-session";
    public const string CsrfHeader = "X-App-Session";
    public const int CookieDays = 365;

    public static string PasswordStamp(string passwordHash) => Hash(passwordHash);
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public async Task<(AppSession Session, string Token)> CreateAsync(User user, CancellationToken ct = default)
    {
        var raw = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var session = new AppSession { UserId = user.Id, TokenHash = Hash(raw), PasswordStamp = PasswordStamp(user.PasswordHash) };
        db.Set<AppSession>().Add(session);
        await db.SaveChangesAsync(ct);
        return (session, raw);
    }

    public async Task<AppSession?> FindValidAsync(string? raw, CancellationToken ct = default)
    {
        if (raw is null || raw.Length != 64 || !raw.All(Uri.IsHexDigit)) return null;
        var hash = Hash(raw);
        var session = await db.Set<AppSession>().Include(s => s.User)
            .SingleOrDefaultAsync(s => s.TokenHash == hash && s.RevokedAt == null, ct);
        return session?.User is { } user && session.PasswordStamp == PasswordStamp(user.PasswordHash) ? session : null;
    }

    public async Task RenewAsync(AppSession session, CancellationToken ct = default)
    {
        session.LastRenewedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    // Stage these changes so callers save password changes and revocations atomically.
    public async Task RevokeAllForUserAsync(int userId, CancellationToken ct = default)
    {
        var sessions = await db.Set<AppSession>().Where(s => s.UserId == userId && s.RevokedAt == null).ToListAsync(ct);
        foreach (var session in sessions) session.RevokedAt = DateTime.UtcNow;
        var subscriptions = await db.Set<PushSubscription>().Where(s => s.UserId == userId).ToListAsync(ct);
        db.Set<PushSubscription>().RemoveRange(subscriptions);
    }

    public async Task<int?> RevokeCookieAsync(string? raw, CancellationToken ct = default)
    {
        if (raw is null || raw.Length != 64 || !raw.All(Uri.IsHexDigit)) return null;
        var hash = Hash(raw);
        var session = await db.Set<AppSession>().SingleOrDefaultAsync(s => s.TokenHash == hash, ct);
        if (session is null) return null;
        session.RevokedAt ??= DateTime.UtcNow;
        var subscriptions = await db.Set<PushSubscription>().Where(s => s.AppSessionId == session.Id).ToListAsync(ct);
        db.Set<PushSubscription>().RemoveRange(subscriptions);
        await db.SaveChangesAsync(ct);
        return session.UserId;
    }

    public async Task<bool> ValidatePrincipalAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        var idClaim = principal.FindFirst(ClaimName);
        if (idClaim is null) return true; // Ordinary web JWTs keep their existing lifetime.
        if (!Guid.TryParse(idClaim.Value, out var id) ||
            !int.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return false;
        var session = await db.Set<AppSession>().AsNoTracking().Include(s => s.User)
            .SingleOrDefaultAsync(s => s.Id == id && s.UserId == userId && s.RevokedAt == null, ct);
        if (session?.User is not { } user || session.PasswordStamp != PasswordStamp(user.PasswordHash)) return false;
        // A demoted administrator must not retain privileges until their next renewal.
        if (principal.Identity is not ClaimsIdentity identity) return false;
        foreach (var claim in identity.FindAll(identity.RoleClaimType).ToList()) identity.RemoveClaim(claim);
        identity.AddClaim(new Claim(identity.RoleClaimType, user.Role));
        return true;
    }
}
