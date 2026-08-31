using Eshopper.Api.Infrastructure;
using Eshopper.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace Eshopper.Api.Controllers;
[ApiController, Route("api/catalog")]
public class CatalogController(ICatalogService catalog, ShopDbContext db) : ControllerBase
{
    [HttpGet("products")] public Task<IReadOnlyList<ProductDto>> Products(string? search, int? categoryId) => catalog.GetProducts(search, categoryId);
    [HttpGet("products/{id:int}")] public async Task<IActionResult> Product(int id) => (await catalog.GetProduct(id)) is { } p ? Ok(p) : NotFound();

    /// <summary>Serves product images straight from the database so uploads survive restarts and scale across instances.</summary>
    [HttpGet("images/{id:int}")]
    public async Task<IActionResult> Image(int id)
    {
        var image = await db.ProductImages.AsNoTracking()
            .Where(i => i.Id == id)
            .Select(i => new { i.Content, i.ContentType, i.UploadedAt })
            .FirstOrDefaultAsync();
        if (image is null) return NotFound();
        // Content is immutable once stored, so it is safe to cache aggressively.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return File(image.Content, image.ContentType);
    }
}
