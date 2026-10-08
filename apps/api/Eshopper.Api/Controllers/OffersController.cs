using System.Security.Claims;
using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Eshopper.Api.Controllers;

public record OfferRequest(string? Title, string? Description, string? ImageUrl, bool Enabled,
    DateTimeOffset? StartsAt, DateTimeOffset? EndsAt);

[ApiController]
public class OffersController(ShopDbContext db) : ControllerBase
{
    private static object ToDto(Offer offer) => new
    {
        offer.Id, offer.Title, offer.Description, offer.ImageUrl, offer.Enabled,
        startsAt = DateTime.SpecifyKind(offer.StartsAt, DateTimeKind.Utc),
        endsAt = DateTime.SpecifyKind(offer.EndsAt, DateTimeKind.Utc),
        updatedAt = DateTime.SpecifyKind(offer.UpdatedAt, DateTimeKind.Utc)
    };

    [HttpGet("api/offers")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> Active()
    {
        var now = DateTime.UtcNow;
        var offers = await db.Offers.AsNoTracking()
            .Where(o => o.Enabled && o.StartsAt <= now && o.EndsAt > now)
            .OrderByDescending(o => o.UpdatedAt).ThenByDescending(o => o.Id).ToListAsync();
        return Ok(offers.Select(ToDto));
    }

    [Authorize(Policy = "AdminOnly")]
    [HttpGet("api/admin/offers")]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 10,
        [FromQuery] string? search = null)
    {
        var query = db.Offers.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(o => o.Title.Contains(term) || o.Description.Contains(term));
        }
        pageSize = Math.Clamp(pageSize, 5, 100);
        var total = await query.CountAsync();
        var pages = Math.Max(1, (int)Math.Ceiling(total / (double)pageSize));
        page = Math.Clamp(page, 1, pages);
        var rows = await query.OrderByDescending(o => o.UpdatedAt).ThenByDescending(o => o.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new { items = rows.Select(ToDto), total, page, pageSize, pages });
    }

    [Authorize(Policy = "AdminOnly")]
    [HttpPost("api/admin/offers")]
    public async Task<IActionResult> Create(OfferRequest request)
    {
        if (await Validate(request) is { } error) return Problem(error, statusCode: 400);
        var offer = new Offer();
        Apply(offer, request);
        db.Offers.Add(offer);
        Audit("OfferCreated", $"Created offer {offer.Title}");
        await db.SaveChangesAsync();
        return Ok(ToDto(offer));
    }

    [Authorize(Policy = "AdminOnly")]
    [HttpPut("api/admin/offers/{id:int}")]
    public async Task<IActionResult> Update(int id, OfferRequest request)
    {
        if (await Validate(request) is { } error) return Problem(error, statusCode: 400);
        var offer = await db.Offers.FindAsync(id);
        if (offer is null) return NotFound();
        Apply(offer, request);
        Audit("OfferUpdated", $"Updated offer #{id} {offer.Title} ({(offer.Enabled ? "enabled" : "disabled")})");
        await db.SaveChangesAsync();
        return Ok(ToDto(offer));
    }

    [Authorize(Policy = "AdminOnly")]
    [HttpDelete("api/admin/offers/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var offer = await db.Offers.FindAsync(id);
        if (offer is null) return NotFound();
        db.Offers.Remove(offer);
        Audit("OfferDeleted", $"Deleted offer #{id} {offer.Title}");
        await db.SaveChangesAsync();
        return Ok(new { message = "Offer deleted." });
    }

    private async Task<string?> Validate(OfferRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 120)
            return "An offer title of 1 to 120 characters is required.";
        if ((request.Description?.Length ?? 0) > 1000) return "Offer description must be 1000 characters or shorter.";
        if (request.StartsAt is null || request.EndsAt is null || request.EndsAt <= request.StartsAt)
            return "Valid start and end times are required. End must be after start.";
        const string prefix = "/api/catalog/images/";
        if (request.ImageUrl is null || !request.ImageUrl.StartsWith(prefix, StringComparison.Ordinal) ||
            !int.TryParse(request.ImageUrl[prefix.Length..], out var imageId) ||
            !await db.ProductImages.AnyAsync(i => i.Id == imageId))
            return "Upload an offer image before saving.";
        return null;
    }

    private static void Apply(Offer offer, OfferRequest request)
    {
        offer.Title = request.Title!.Trim();
        offer.Description = request.Description?.Trim() ?? "";
        offer.ImageUrl = request.ImageUrl!;
        offer.Enabled = request.Enabled;
        offer.StartsAt = request.StartsAt!.Value.UtcDateTime;
        offer.EndsAt = request.EndsAt!.Value.UtcDateTime;
        offer.UpdatedAt = DateTime.UtcNow;
    }

    private void Audit(string action, string details) => db.AuditActivities.Add(new AuditActivity
    {
        Action = action, Details = details,
        UserId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null
    });
}
