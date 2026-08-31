using System.Security.Claims;
using Eshopper.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace Eshopper.Api.Controllers;
[ApiController, Route("api/orders"), Authorize]
public class OrdersController(ShopDbContext db) : ControllerBase
{
    [HttpGet] public async Task<IActionResult> Mine()
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return Unauthorized();
        return Ok(await db.Orders.Where(o => o.UserId == id).Include(o => o.Items).Include(o => o.Payment).Include(o => o.ShippingAddress).OrderByDescending(o => o.CreatedAt).ToListAsync());
    }
}
