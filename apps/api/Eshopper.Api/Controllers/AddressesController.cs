using System.Security.Claims;
using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Eshopper.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Eshopper.Api.Controllers;

/// <summary>An address book entry supplied by the shopper. Shares the checkout validation rules.</summary>
public record SavedAddressRequest(
    string? FullName = null, string? Phone = null, string? Line1 = null, string? Line2 = null,
    string? City = null, string? State = null, string? PostalCode = null, string? Country = null,
    string? Landmark = null, bool IsDefault = false);

/// <summary>
/// The signed-in shopper's reusable address book. Every action is scoped to the caller's own
/// user id, so one shopper can never read or change another's addresses.
/// </summary>
[ApiController, Route("api/addresses"), Authorize]
public class AddressesController(ShopDbContext db) : ControllerBase
{
    private int? CurrentUserId() => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    private static object ToDto(SavedAddress a) => new
    {
        a.Id, a.FullName, a.Phone, a.Line1, a.Line2, a.City, a.State,
        a.PostalCode, a.Country, a.Landmark, a.IsDefault, a.CreatedAt, a.UpdatedAt
    };

    [HttpGet]
    public async Task<IActionResult> List()
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        var rows = await db.SavedAddresses.AsNoTracking()
            .Where(a => a.UserId == userId)
            .OrderByDescending(a => a.IsDefault).ThenByDescending(a => a.UpdatedAt)
            .ToListAsync();
        return Ok(rows.Select(ToDto));
    }

    [HttpPost]
    public async Task<IActionResult> Create(SavedAddressRequest request)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        if (Validate(request) is { } error) return Problem(error, statusCode: 400);

        // The first address a shopper saves becomes their default, so checkout always has one preselected.
        var isFirst = !await db.SavedAddresses.AnyAsync(a => a.UserId == userId);
        var address = new SavedAddress { UserId = userId };
        Apply(address, request);
        address.IsDefault = request.IsDefault || isFirst;
        db.SavedAddresses.Add(address);
        await db.SaveChangesAsync();
        if (address.IsDefault) await MakeSoleDefault(userId, address.Id);
        return Ok(ToDto(address));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, SavedAddressRequest request)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        if (Validate(request) is { } error) return Problem(error, statusCode: 400);
        var address = await db.SavedAddresses.SingleOrDefaultAsync(a => a.Id == id && a.UserId == userId);
        if (address is null) return NotFound();

        Apply(address, request);
        address.UpdatedAt = DateTime.UtcNow;
        if (request.IsDefault) address.IsDefault = true;
        await db.SaveChangesAsync();
        if (address.IsDefault) await MakeSoleDefault(userId, address.Id);
        return Ok(ToDto(address));
    }

    [HttpPost("{id:int}/default")]
    public async Task<IActionResult> SetDefault(int id)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        if (!await db.SavedAddresses.AnyAsync(a => a.Id == id && a.UserId == userId)) return NotFound();
        await MakeSoleDefault(userId, id);
        return Ok(new { id, isDefault = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        var address = await db.SavedAddresses.SingleOrDefaultAsync(a => a.Id == id && a.UserId == userId);
        if (address is null) return NotFound();
        var wasDefault = address.IsDefault;
        db.SavedAddresses.Remove(address);
        await db.SaveChangesAsync();

        // Never leave the book without a default, or checkout would have nothing preselected.
        if (wasDefault)
        {
            var next = await db.SavedAddresses.Where(a => a.UserId == userId)
                .OrderByDescending(a => a.UpdatedAt).FirstOrDefaultAsync();
            if (next is not null) { next.IsDefault = true; await db.SaveChangesAsync(); }
        }
        return Ok(new { id });
    }

    /// <summary>Clears the flag from every other address so exactly one default survives.</summary>
    private async Task MakeSoleDefault(int userId, int addressId)
    {
        var all = await db.SavedAddresses.Where(a => a.UserId == userId).ToListAsync();
        foreach (var a in all) a.IsDefault = a.Id == addressId;
        await db.SaveChangesAsync();
    }

    private static void Apply(SavedAddress a, SavedAddressRequest r)
    {
        a.FullName = r.FullName!.Trim();
        a.Phone = new string((r.Phone ?? "").Where(char.IsDigit).ToArray());
        a.Line1 = r.Line1!.Trim();
        a.Line2 = r.Line2?.Trim() ?? "";
        a.City = r.City!.Trim();
        a.State = r.State!.Trim();
        a.PostalCode = r.PostalCode!.Trim();
        a.Country = string.IsNullOrWhiteSpace(r.Country) ? "India" : r.Country.Trim();
        a.Landmark = r.Landmark?.Trim() ?? "";
    }

    /// <summary>Reuses the checkout rules so a saved address can never fail at payment time.</summary>
    private static string? Validate(SavedAddressRequest r) => CheckoutService.ValidateAddress(
        new ShippingAddressRequest(r.FullName, r.Phone, r.Line1, r.Line2, r.City, r.State, r.PostalCode, r.Country, r.Landmark));
}
