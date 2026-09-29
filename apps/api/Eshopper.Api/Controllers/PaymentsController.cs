using System.Security.Claims;
using Eshopper.Api.Infrastructure;
using Eshopper.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace Eshopper.Api.Controllers;

/// <summary>Items the shopper wants to pay for. The price is never taken from the request.</summary>
public record RazorpayOrderRequest(IReadOnlyList<CartLine>? Items = null);

[ApiController, Route("api/payments")]
public class PaymentsController(IPaymentGateway gateway, IRazorpayGateway razorpay, ShopDbContext db, ILogger<PaymentsController> logger) : ControllerBase
{
    private int? CurrentUserId() => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    /// <summary>
    /// Payment methods available at checkout. When Razorpay is configured it is the only option:
    /// the simulated test methods are a development fallback and must never be offered in production.
    /// </summary>
    [HttpGet("methods")]
    public IActionResult Methods()
    {
        var methods = new List<PaymentMethodInfo>();
        if (razorpay.Enabled)
            methods.Add(new(CheckoutService.RazorpayMethod, "Pay Online (Razorpay)", "UPI, cards, netbanking and wallets.", false));
        else
            methods.AddRange(gateway.Methods);

        return Ok(new
        {
            provider = razorpay.Enabled ? "Razorpay" : "The Bathany Secure Pay",
            sandbox = true,
            razorpayEnabled = razorpay.Enabled,
            razorpayKeyId = razorpay.Enabled ? razorpay.KeyId : "",
            methods,
            testCards = razorpay.Enabled ? Array.Empty<object>() : gateway.TestCards.Cast<object>().ToArray()
        });
    }

    /// <summary>
    /// Opens a Razorpay order for the cart. The amount is computed here from live database prices,
    /// so the browser cannot choose what it pays.
    /// </summary>
    [Authorize]
    [HttpPost("razorpay/order")]
    public async Task<IActionResult> CreateRazorpayOrder(RazorpayOrderRequest request)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        if (!razorpay.Enabled) return Problem("Online payment is not available right now.", statusCode: 503);
        if (request.Items is null || request.Items.Count == 0) return Problem("Your cart is empty.", statusCode: 400);
        if (request.Items.Any(i => i.Quantity < 1)) return Problem("Invalid quantity.", statusCode: 400);

        var ids = request.Items.Select(i => i.ProductId).Distinct().ToList();
        var products = await db.Products.Where(p => ids.Contains(p.Id) && p.IsActive).ToDictionaryAsync(p => p.Id);
        if (products.Count != ids.Count) return Problem("One of the items is no longer available.", statusCode: 400);
        if (request.Items.Any(i => products[i.ProductId].Stock < i.Quantity)) return Problem("One of the items is out of stock.", statusCode: 400);

        var total = request.Items.Sum(i => products[i.ProductId].Price * i.Quantity);
        if (total <= 0) return Problem("Order total must be greater than zero.", statusCode: 400);

        try
        {
            var order = await razorpay.CreateOrderAsync(total, $"bth-{userId}-{DateTime.UtcNow:yyMMddHHmmss}",
                new Dictionary<string, string> { ["userId"] = userId.ToString(), ["store"] = "The Bathany" }, HttpContext.RequestAborted);
            var user = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.Email, u.DisplayName }).SingleOrDefaultAsync();
            return Ok(new
            {
                orderId = order.Id,
                amount = order.AmountMinor,
                currency = order.Currency,
                keyId = razorpay.KeyId,
                displayAmount = total,
                customer = new { name = user?.DisplayName ?? "", email = user?.Email ?? "" }
            });
        }
        catch (InvalidOperationException ex)
        {
            return Problem(ex.Message, statusCode: 502);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogError(ex, "Could not reach Razorpay to create an order.");
            return Problem("Could not reach the payment provider. Please try again.", statusCode: 504);
        }
    }

    /// <summary>The signed-in shopper's own payment history, newest first.</summary>
    [Authorize]
    [HttpGet("history")]
    public async Task<IActionResult> History()
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        var rows = await db.Payments.AsNoTracking()
            .Join(db.Orders.AsNoTracking().Where(o => o.UserId == userId), p => p.OrderId, o => o.Id, (p, o) => new { p, o })
            .OrderByDescending(x => x.p.ProcessedAt)
            .Select(x => new
            {
                x.p.Id,
                orderId = x.p.OrderId,
                x.p.Amount,
                x.p.Currency,
                x.p.Status,
                x.p.Method,
                x.p.Provider,
                x.p.CardBrand,
                x.p.CardLast4,
                x.p.TransactionId,
                x.p.ProviderPaymentId,
                x.p.FailureReason,
                x.p.RefundedAmount,
                x.p.ProcessedAt,
                orderStatus = x.o.Status
            })
            .ToListAsync();
        return Ok(rows);
    }
}
