using System.Security.Claims;
using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Eshopper.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Eshopper.Api.Controllers;

public record PushKeys(string? P256dh, string? Auth);
public record PushRegistration(string? Endpoint, PushKeys? Keys);
public record PushRemoval(string? Endpoint);

[ApiController, Route("api/admin/push"), Authorize(Policy = "AdminOnly")]
public sealed class PushController(ShopDbContext db, AdminPushOptions options) : ControllerBase
{
    private async Task<int?> CurrentAdminAsync(CancellationToken ct)
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return null;
        Guid? sessionId = null;
        if (User.FindFirstValue(AppSessionService.ClaimName) is { } sid)
        {
            if (!Guid.TryParse(sid, out var parsed)) return null;
            sessionId = parsed;
        }
        return await PushValidation.IsAuthorizedRecipientAsync(db, id, sessionId, ct) ? id : null;
    }

    [HttpGet("config")]
    public async Task<IActionResult> Config(CancellationToken ct)
    {
        if (await CurrentAdminAsync(ct) is null) return Forbid();
        Response.Headers.CacheControl = "no-store";
        return Ok(new { enabled = options.Enabled, publicKey = options.Enabled ? options.PublicKey : null,
            message = options.Enabled ? null : "Web Push is unavailable: the server VAPID configuration is missing or invalid." });
    }

    [HttpPost("status"), RequestSizeLimit(4096)]
    public async Task<IActionResult> Status(PushRemoval request, CancellationToken ct)
    {
        if (await CurrentAdminAsync(ct) is not { } userId) return Forbid();
        if (request.Endpoint is not null && !PushValidation.IsAllowedEndpoint(request.Endpoint)) return BadRequest();
        Response.Headers.CacheControl = "no-store";
        var hash = request.Endpoint is null ? null : PushValidation.EndpointHash(request.Endpoint);
        var row = hash is null ? null : await db.Set<PushSubscription>().AsNoTracking()
            .SingleOrDefaultAsync(s => s.UserId == userId && s.EndpointHash == hash, ct);
        return Ok(new
        {
            enabled = options.Enabled,
            publicKey = options.Enabled ? options.PublicKey : null,
            subscribed = row is not null,
            suspended = row?.Suspended ?? false,
            message = options.Enabled ? null : "Web Push is unavailable: the server VAPID configuration is missing or invalid."
        });
    }

    [HttpPost("subscriptions"), RequestSizeLimit(8192)]
    public async Task<IActionResult> Subscribe(PushRegistration request, CancellationToken ct)
    {
        if (await CurrentAdminAsync(ct) is not { } userId) return Forbid();
        if (!options.Enabled) return Problem("Web Push is not configured on the server.", statusCode: 503);
        if (!PushValidation.IsAllowedEndpoint(request.Endpoint) || !PushValidation.AreValidKeys(request.Keys?.P256dh, request.Keys?.Auth))
            return Problem("Invalid or unsupported push endpoint or encryption keys.", statusCode: 400);
        var hash = PushValidation.EndpointHash(request.Endpoint!);
        var row = await db.Set<PushSubscription>().SingleOrDefaultAsync(s => s.EndpointHash == hash, ct);
        if (row is not null && row.UserId != userId)
            return Conflict(new { message = "This browser subscription belongs to another account. Disable it before switching accounts." });
        if (row is null)
        {
            if (await db.Set<PushSubscription>().CountAsync(s => s.UserId == userId, ct) >= 10)
                return Problem("Maximum push subscriptions reached. Remove an existing device first.", statusCode: 409);
            row = new PushSubscription
            {
                UserId = userId, Endpoint = request.Endpoint!, EndpointHash = hash,
                LastActivityId = await db.AuditActivities.MaxAsync(a => (int?)a.Id, ct) ?? 0
            };
            db.Add(row);
        }
        row.P256dh = request.Keys!.P256dh!;
        row.Auth = request.Keys.Auth!;
        row.AppSessionId = Guid.TryParse(User.FindFirstValue(AppSessionService.ClaimName), out var appSessionId) ? appSessionId : null;
        row.FailureCount = 0;
        row.Suspended = false;
        row.NextAttemptAt = DateTime.UtcNow;
        row.Version = Guid.NewGuid().ToString("N");
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "Subscription changed; please retry." }); }
        return Ok(new { subscribed = true });
    }

    [HttpDelete("subscriptions"), RequestSizeLimit(4096)]
    public async Task<IActionResult> Unsubscribe(PushRemoval request, CancellationToken ct)
    {
        if (await CurrentAdminAsync(ct) is not { } userId) return Forbid();
        if (!PushValidation.IsAllowedEndpoint(request.Endpoint)) return BadRequest();
        var hash = PushValidation.EndpointHash(request.Endpoint!);
        var row = await db.Set<PushSubscription>().SingleOrDefaultAsync(s => s.UserId == userId && s.EndpointHash == hash, ct);
        if (row is not null)
        {
            db.Remove(row);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { return Conflict(new { message = "Subscription changed; please retry." }); }
        }
        return NoContent();
    }
}
