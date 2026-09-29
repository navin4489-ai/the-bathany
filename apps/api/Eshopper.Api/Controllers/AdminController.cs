using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Eshopper.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
namespace Eshopper.Api.Controllers;

public record AdminResetPasswordRequest(string NewPassword);
public record ProductRequest(string? Name = null, string? Description = null, decimal Price = 0, int Stock = 0, string? ImageUrl = null, int CategoryId = 1, bool IsActive = true);
public record OrderStatusRequest(string? Status = null);
public record UserRoleRequest(string? Role = null);

[ApiController, Route("api/admin")]
[Authorize(Policy = "AdminOnly")]
public class AdminController(ShopDbContext db, IPasswordService passwords, IEmailService email) : ControllerBase
{
    private static readonly string[] OrderStatuses = ["Pending", "Paid", "Processing", "Shipped", "Delivered", "Cancelled", "Refunded", "PaymentFailed"];
    private static readonly string[] Roles = ["Customer", "Admin"];

    private void Audit(string action, string details) =>
        db.AuditActivities.Add(new AuditActivity { Action = action, Details = details, UserId = CurrentUserId() });

    private int? CurrentUserId() => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    /// <summary>Drives the admin UI: which sections exist, their columns and the allowed option lists.</summary>
    [HttpGet("config")]
    public async Task<IActionResult> Config() => Ok(new
    {
        currency = new { code = "INR", symbol = "\u20b9", locale = "en-IN" },
        orderStatuses = OrderStatuses,
        roles = Roles,
        categories = await db.Categories.AsNoTracking().Select(c => new { c.Id, c.Name }).ToListAsync(),
        sections = new object[]
        {
            new { key = "dashboard", label = "Dashboard", icon = "\u25a4" },
            new { key = "products", label = "Products", icon = "\u25a6" },
            new { key = "orders", label = "Orders", icon = "\ud83e\uddfe" },
            new { key = "payments", label = "Payments", icon = "\ud83d\udcb3" },
            new { key = "users", label = "Users", icon = "\ud83d\udc65" },
            new { key = "activity", label = "Activity", icon = "\ud83d\udd52" }
        }
    });

    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        var orders = await db.Orders.AsNoTracking().Select(o => new { o.Total, o.Status }).ToListAsync();
        var paid = orders.Where(o => o.Status is "Paid" or "Processing" or "Shipped" or "Delivered").ToList();
        return Ok(new
        {
            products = await db.Products.CountAsync(),
            lowStock = await db.Products.CountAsync(p => p.Stock <= 5),
            orders = orders.Count,
            pendingOrders = orders.Count(o => o.Status == "Pending"),
            users = await db.Users.CountAsync(),
            revenue = paid.Sum(o => o.Total),
            activity = await db.AuditActivities.CountAsync()
        });
    }

    [HttpGet("categories")] public Task<List<Category>> Categories() => db.Categories.AsNoTracking().ToListAsync();

    /// <summary>Accepts a product image upload and returns the public URL to store on the product.</summary>
    [HttpPost("uploads/product-image")]
    [RequestSizeLimit(4 * 1024 * 1024)]
    public async Task<IActionResult> UploadProductImage(IFormFile? file)
    {
        if (file is null || file.Length == 0) return Problem("Choose an image to upload.", statusCode: 400);
        if (file.Length > 4 * 1024 * 1024) return Problem("Images must be 4 MB or smaller.", statusCode: 400);

        var allowed = new Dictionary<string, (string ContentType, byte[][] Signatures)>(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = ("image/jpeg", [[0xFF, 0xD8, 0xFF]]), [".jpeg"] = ("image/jpeg", [[0xFF, 0xD8, 0xFF]]),
            [".png"] = ("image/png", [[0x89, 0x50, 0x4E, 0x47]]), [".gif"] = ("image/gif", [[0x47, 0x49, 0x46]]),
            [".webp"] = ("image/webp", [[0x52, 0x49, 0x46, 0x46]])
        };
        var extension = Path.GetExtension(file.FileName);
        if (string.IsNullOrEmpty(extension) || !allowed.TryGetValue(extension, out var kind))
            return Problem("Only JPG, PNG, GIF or WEBP images are allowed.", statusCode: 400);

        // Verify the magic bytes so a renamed executable cannot be stored as an image.
        await using var stream = file.OpenReadStream();
        var header = new byte[4];
        var read = await stream.ReadAsync(header);
        if (read < 3 || !kind.Signatures.Any(sig => header.Take(sig.Length).SequenceEqual(sig)))
            return Problem("That file does not look like a valid image.", statusCode: 400);
        stream.Position = 0;

        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer);
        var image = new ProductImage
        {
            FileName = $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}",
            // Derived from the verified extension, never from the client-supplied header.
            ContentType = kind.ContentType,
            Content = buffer.ToArray(),
            Length = buffer.Length,
            UploadedByUserId = CurrentUserId()
        };
        db.ProductImages.Add(image);
        Audit("ProductImageUploaded", $"Uploaded image {image.FileName} ({image.Length} bytes)");
        await db.SaveChangesAsync();

        // Relative URL: the SPA proxies /api, so the image stays reachable regardless of host or port.
        return Ok(new { url = $"/api/catalog/images/{image.Id}" });
    }

    [HttpGet("products")]
    public Task<List<object>> Products() => db.Products.AsNoTracking().OrderBy(p => p.Id)
        .Select(p => (object)new { p.Id, p.Name, p.Description, p.Price, p.Stock, p.ImageUrl, p.CategoryId, p.IsActive }).ToListAsync();

    [HttpPost("products")]
    public async Task<IActionResult> Add(ProductRequest input)
    {
        if (Invalid(input) is { } error) return Problem(error, statusCode: 400);
        if (string.IsNullOrWhiteSpace(input.ImageUrl)) return Problem("Upload an image before saving this product.", statusCode: 400);
        var product = new Product
        {
            Name = input.Name!.Trim(), Description = input.Description?.Trim() ?? "", Price = input.Price,
            Stock = input.Stock, ImageUrl = input.ImageUrl.Trim(),
            CategoryId = input.CategoryId, IsActive = input.IsActive
        };
        db.Products.Add(product);
        Audit("ProductCreated", $"Created product {product.Name}");
        await db.SaveChangesAsync();
        return Ok(product);
    }

    [HttpPut("products/{id:int}")]
    public async Task<IActionResult> Update(int id, ProductRequest input)
    {
        if (Invalid(input) is { } error) return Problem(error, statusCode: 400);
        var p = await db.Products.FindAsync(id);
        if (p is null) return NotFound();
        p.Name = input.Name!.Trim(); p.Description = input.Description?.Trim() ?? ""; p.Price = input.Price;
        p.Stock = input.Stock; p.CategoryId = input.CategoryId; p.IsActive = input.IsActive;
        if (!string.IsNullOrWhiteSpace(input.ImageUrl)) p.ImageUrl = input.ImageUrl.Trim();
        Audit("ProductUpdated", $"Updated product {p.Name}");
        await db.SaveChangesAsync();
        return Ok(p);
    }

    /// <summary>Products referenced by existing orders are deactivated rather than deleted so order history stays intact.</summary>
    [HttpDelete("products/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var p = await db.Products.FindAsync(id);
        if (p is null) return NotFound();
        if (await db.OrderItems.AnyAsync(i => i.ProductId == id))
        {
            p.IsActive = false;
            Audit("ProductDeactivated", $"Deactivated product {p.Name} (referenced by orders)");
            await db.SaveChangesAsync();
            return Ok(new { message = $"{p.Name} has past orders, so it was deactivated instead of deleted." });
        }
        db.Products.Remove(p);
        Audit("ProductDeleted", $"Deleted product {p.Name}");
        await db.SaveChangesAsync();
        return Ok(new { message = $"{p.Name} deleted." });
    }

    private static string? Invalid(ProductRequest input)
    {
        if (string.IsNullOrWhiteSpace(input.Name)) return "Product name is required.";
        if (input.Price <= 0) return "Price must be greater than zero.";
        if (input.Stock < 0) return "Stock cannot be negative.";
        return null;
    }

    [HttpGet("orders")]
    public async Task<IActionResult> Orders()
    {
        var orders = await db.Orders.AsNoTracking().Include(o => o.Items).Include(o => o.Payment).Include(o => o.ShippingAddress)
            .OrderByDescending(o => o.CreatedAt).ToListAsync();
        var emails = await db.Users.AsNoTracking().ToDictionaryAsync(u => u.Id, u => u.Email);
        return Ok(orders.Select(o => new
        {
            o.Id, o.UserId,
            customer = emails.TryGetValue(o.UserId, out var email) ? email : "unknown",
            o.Total, o.Status, o.CreatedAt,
            items = o.Items.Select(i => new { i.ProductName, i.UnitPrice, i.Quantity }),
            payment = o.Payment is null ? null : new { o.Payment.Method, o.Payment.Status, o.Payment.CardBrand, o.Payment.CardLast4, o.Payment.TransactionId },
            shippingAddress = o.ShippingAddress is null ? null : new
            {
                o.ShippingAddress.FullName, o.ShippingAddress.Phone, o.ShippingAddress.Line1, o.ShippingAddress.Line2,
                o.ShippingAddress.City, o.ShippingAddress.State, o.ShippingAddress.PostalCode, o.ShippingAddress.Country, o.ShippingAddress.Landmark
            }
        }));
    }

    [HttpPut("orders/{id:int}/status")]
    public async Task<IActionResult> UpdateOrderStatus(int id, OrderStatusRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Status) || !OrderStatuses.Contains(request.Status))
            return Problem($"Status must be one of: {string.Join(", ", OrderStatuses)}.", statusCode: 400);
        var order = await db.Orders.Include(o => o.Items).Include(o => o.ShippingAddress).SingleOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound();
        var previous = order.Status;
        if (previous == request.Status) return Ok(new { order.Id, order.Status });
        order.Status = request.Status;
        Audit("OrderStatusChanged", $"Order #{id} moved from {previous} to {request.Status}");
        await db.SaveChangesAsync();

        // Keep the shopper informed; a mail failure must not fail the status change.
        var customerEmail = await db.Users.AsNoTracking().Where(u => u.Id == order.UserId).Select(u => u.Email).SingleOrDefaultAsync();
        if (!string.IsNullOrWhiteSpace(customerEmail)) await email.SendOrderStatusAsync(order, customerEmail, previous);
        return Ok(new { order.Id, order.Status });
    }

    /// <summary>
    /// Full payment ledger for reconciliation against the Razorpay dashboard. Supports filtering by
    /// status, provider and a free-text search across reference, customer and order number.
    /// </summary>
    [HttpGet("payments")]
    public async Task<IActionResult> Payments([FromQuery] string? status = null, [FromQuery] string? provider = null, [FromQuery] string? search = null)
    {
        var query = from p in db.Payments.AsNoTracking()
                    join o in db.Orders.AsNoTracking() on p.OrderId equals o.Id
                    join u in db.Users.AsNoTracking() on o.UserId equals u.Id into gu
                    from u in gu.DefaultIfEmpty()
                    select new
                    {
                        p.Id, p.OrderId, p.Amount, p.Currency, p.Status, p.Method, p.Provider,
                        p.CardBrand, p.CardLast4, p.TransactionId, p.ProviderOrderId, p.ProviderPaymentId,
                        p.FailureReason, p.RefundedAmount, p.ProcessedAt,
                        orderStatus = o.Status,
                        userId = o.UserId,
                        customer = u != null ? u.Email : "unknown",
                        customerName = u != null ? u.DisplayName : ""
                    };

        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
        if (!string.IsNullOrWhiteSpace(provider)) query = query.Where(x => x.Provider == provider);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(x =>
                x.TransactionId.Contains(term) ||
                x.ProviderPaymentId.Contains(term) ||
                x.ProviderOrderId.Contains(term) ||
                x.customer.Contains(term) ||
                x.OrderId.ToString() == term);
        }

        var rows = await query.OrderByDescending(x => x.ProcessedAt).Take(500).ToListAsync();
        // Only money that actually settled counts as captured revenue.
        var captured = rows.Where(r => r.Status is "Approved" or "Captured").ToList();
        return Ok(new
        {
            summary = new
            {
                count = rows.Count,
                captured = captured.Count,
                failed = rows.Count(r => r.Status is "Declined" or "Failed"),
                pending = rows.Count(r => r.Status is "Pending" or "Authorized"),
                capturedAmount = captured.Sum(r => r.Amount),
                refundedAmount = rows.Sum(r => r.RefundedAmount),
                online = rows.Count(r => r.Provider == "razorpay")
            },
            providers = await db.Payments.AsNoTracking().Select(p => p.Provider).Distinct().ToListAsync(),
            statuses = await db.Payments.AsNoTracking().Select(p => p.Status).Distinct().ToListAsync(),
            items = rows
        });
    }

    [HttpGet("users")] public Task<List<object>> Users() => db.Users.AsNoTracking().OrderBy(u => u.Id)        .Select(u => (object)new { u.Id, u.Email, u.DisplayName, u.Role, u.CreatedAt }).ToListAsync();

    [HttpPut("users/{id:int}/role")]
    public async Task<IActionResult> UpdateRole(int id, UserRoleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Role) || !Roles.Contains(request.Role))
            return Problem($"Role must be one of: {string.Join(", ", Roles)}.", statusCode: 400);
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();
        // Never let the last remaining admin be demoted out of the system.
        if (user.Role == "Admin" && request.Role != "Admin" && await db.Users.CountAsync(u => u.Role == "Admin") <= 1)
            return Problem("You cannot remove the last remaining admin.", statusCode: 400);
        user.Role = request.Role;
        Audit("UserRoleChanged", $"{user.Email} is now {request.Role}");
        await db.SaveChangesAsync();
        return Ok(new { user.Id, user.Role });
    }

    /// <summary>Admin-initiated password reset. The admin sets a new password directly for a user.</summary>
    [HttpPost("users/{id:int}/reset-password")]
    public async Task<IActionResult> ResetUserPassword(int id, AdminResetPasswordRequest request)
    {
        if (passwords.Validate(request.NewPassword) is { } invalid) return Problem(invalid, statusCode: 400);
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id);
        if (user is null) return NotFound();

        user.PasswordHash = passwords.Hash(request.NewPassword);
        // Any outstanding self-service reset links become invalid.
        foreach (var t in await db.PasswordResetTokens.Where(t => t.UserId == id && t.UsedAt == null).ToListAsync()) t.UsedAt = DateTime.UtcNow;

        var actor = User.FindFirstValue(ClaimTypes.Email) ?? "admin";
        db.AuditActivities.Add(new AuditActivity { UserId = id, Action = "AdminPasswordReset", Details = $"Password reset for {user.Email} by {actor}" });
        await db.SaveChangesAsync();
        return Ok(new { message = $"Password updated for {user.Email}." });
    }

    [HttpGet("activity")]
    public Task<List<AuditActivity>> Activity() => db.AuditActivities.AsNoTracking().OrderByDescending(a => a.CreatedAt).Take(200).ToListAsync();

    /// <summary>
    /// Poll for activity newer than <paramref name="afterId"/> so the admin console can alert on
    /// orders and customer activity. Passing no cursor returns only the latest id, which lets a
    /// freshly opened console establish a baseline without replaying historic events as "new".
    /// </summary>
    [HttpGet("notifications")]
    public async Task<IActionResult> Notifications([FromQuery] int? afterId = null)
    {
        var latestId = await db.AuditActivities.AsNoTracking().MaxAsync(a => (int?)a.Id) ?? 0;
        if (afterId is null) return Ok(new { latestId, items = Array.Empty<AuditActivity>() });

        var items = await db.AuditActivities.AsNoTracking()
            .Where(a => a.Id > afterId)
            .OrderBy(a => a.Id)
            .Take(50)
            .ToListAsync();
        return Ok(new { latestId, items });
    }
}
