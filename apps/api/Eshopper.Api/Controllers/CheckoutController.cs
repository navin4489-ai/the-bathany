using Eshopper.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
namespace Eshopper.Api.Controllers;
[ApiController, Route("api/checkout")]
[Authorize]
public class CheckoutController(ICheckoutService checkout) : ControllerBase
{
    [HttpPost] public async Task<IActionResult> Create(CheckoutRequest request)
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return Unauthorized();
        var result = await checkout.Checkout(userId, request);
        return result.Order is { } order
            ? Ok(new
            {
                order.Id,
                order.Total,
                order.Status,
                order.CreatedAt,
                Payment = order.Payment is null ? null : new
                {
                    order.Payment.Status,
                    order.Payment.TransactionId,
                    order.Payment.Amount,
                    order.Payment.Method,
                    order.Payment.CardBrand,
                    order.Payment.CardLast4,
                    order.Payment.FailureReason,
                    order.Payment.ProcessedAt
                },
                Items = order.Items.Select(i => new { i.ProductId, i.ProductName, i.UnitPrice, i.Quantity }),
                ShippingAddress = order.ShippingAddress is null ? null : new
                {
                    order.ShippingAddress.FullName, order.ShippingAddress.Phone, order.ShippingAddress.Line1,
                    order.ShippingAddress.Line2, order.ShippingAddress.City, order.ShippingAddress.State,
                    order.ShippingAddress.PostalCode, order.ShippingAddress.Country, order.ShippingAddress.Landmark
                }
            })
            : Problem(result.Error, statusCode: 400);
    }
}
