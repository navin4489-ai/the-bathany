using System.Collections.Concurrent;
using System.Security.Claims;
using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Eshopper.Api.Controllers;

public record ClientActivityRequest(string? Action = null, int? ProductId = null, int? Quantity = null, string? Path = null);

/// <summary>
/// Records shopper actions that happen purely in the browser (cart and wishlist live in local storage).
/// Only a fixed set of actions is accepted and product names are looked up server-side, so a client
/// cannot write arbitrary text into the admin audit log. Anonymous visitors are logged with a null user.
/// </summary>
[ApiController, Route("api/activity")]
public class ActivityController(ShopDbContext db) : ControllerBase
{
    private static readonly Dictionary<string, string> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CartAdd"] = "added to cart",
        ["CartRemove"] = "removed from cart",
        ["CartQuantityChanged"] = "changed cart quantity",
        ["ProductView"] = "viewed product",
        ["WishlistAdd"] = "saved to wishlist",
        ["WishlistRemove"] = "removed from wishlist",
        ["PageView"] = "visited page",
        ["Search"] = "searched the collection",
        ["CheckoutStarted"] = "started checkout",
        ["PaymentCancelled"] = "cancelled the payment window",
        ["PaymentFailed"] = "reported a failed payment attempt",
        ["OfferClick"] = "opened a promotional offer"
    };
    private static readonly HashSet<string> PublicPaths = new(StringComparer.Ordinal)
    {
        "/", "/shop", "/rituals", "/ingredients", "/care", "/about", "/contact",
        "/cart", "/wishlist", "/login", "/register", "/forgot-password", "/reset-password",
        "/orders", "/payments", "/admin", "/install/android", "/install/ios"
    };

    // Simple per-IP throttle so the public endpoint cannot be used to flood the audit table.
    private static readonly ConcurrentDictionary<string, (DateTime Window, int Count)> Hits = new();
    private const int MaxPerMinute = 60;

    [HttpPost, RequestSizeLimit(4096)]
    public async Task<IActionResult> Record(ClientActivityRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Action) || !Allowed.TryGetValue(request.Action, out var verb))
            return Problem("Unknown activity.", statusCode: 400);
        var action = Allowed.Keys.First(k => k.Equals(request.Action, StringComparison.OrdinalIgnoreCase));
        var needsProduct = action is "CartAdd" or "CartRemove" or "CartQuantityChanged" or
            "WishlistAdd" or "WishlistRemove" or "ProductView";
        if (action == "PageView" && (request.Path is null || !PublicPaths.Contains(request.Path)))
            return Problem("Unknown page. Query strings and private URLs must not be recorded.", statusCode: 400);
        if (request.Quantity is < 1 or > 999)
            return Problem("Invalid activity quantity.", statusCode: 400);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var now = DateTime.UtcNow;
        var entry = Hits.AddOrUpdate(ip, _ => (now, 1), (_, e) => now - e.Window > TimeSpan.FromMinutes(1) ? (now, 1) : (e.Window, e.Count + 1));
        if (entry.Count > MaxPerMinute) return StatusCode(429);
        if (Hits.Count > 10_000) foreach (var stale in Hits.Where(h => now - h.Value.Window > TimeSpan.FromMinutes(1)).ToList()) Hits.TryRemove(stale.Key, out _);

        var product = request.ProductId is { } pid
            ? await db.Products.AsNoTracking().Where(p => p.Id == pid).Select(p => p.Name).SingleOrDefaultAsync()
            : null;
        if (needsProduct && product is null) return Problem("Unknown product.", statusCode: 400);

        int? userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
        var who = User.FindFirstValue(ClaimTypes.Email) ?? "Guest";
        var qty = request.Quantity is > 1 and <= 999 ? $" × {request.Quantity}" : "";
        var target = needsProduct ? $" {product}{qty}" : action == "PageView" ? $" {request.Path}" : "";
        db.AuditActivities.Add(new AuditActivity { UserId = userId, Action = action, Details = $"{who}: {verb}{target}" });
        await db.SaveChangesAsync();
        return Accepted();
    }
}
