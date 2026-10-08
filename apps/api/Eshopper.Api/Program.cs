using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Eshopper.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.IdentityModel.Tokens;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
// wwwroot must exist before the host is built, otherwise WebRootPath stays null and UseStaticFiles serves nothing.
Directory.CreateDirectory(Path.Combine(builder.Environment.ContentRootPath, "wwwroot", "uploads"));
builder.Environment.WebRootPath = Path.Combine(builder.Environment.ContentRootPath, "wwwroot");
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHealthChecks();
if (builder.Configuration["Database:Provider"] == "InMemory")
    builder.Services.AddDbContext<ShopDbContext>(o => o.UseInMemoryDatabase("EshopperDevelopment").ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));
else
    builder.Services.AddDbContext<ShopDbContext>(o =>
        o.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection"), sql => sql.CommandTimeout(10)));
builder.Services.AddHttpContextAccessor();
// Traefik terminates TLS and forwards the real client address. Only the proxy-appended (last) hop is
// trusted, so a client cannot spoof its logged IP by sending its own X-Forwarded-For header.
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    o.ForwardLimit = 1;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});
builder.Services.AddScoped<ICatalogService, CatalogService>();
builder.Services.AddScoped<ICheckoutService, CheckoutService>();
builder.Services.AddSingleton<IPaymentGateway, DummyPaymentGateway>();
builder.Services.AddSingleton<IPasswordService, PasswordService>();
builder.Services.AddScoped<AppSessionService>();
builder.Services.AddSingleton(AdminPushOptions.FromEnvironment());
builder.Services.AddHostedService<AdminPushService>();
var razorpayOptions = builder.Configuration.GetSection("Razorpay").Get<RazorpayOptions>() ?? new RazorpayOptions();
if (string.IsNullOrWhiteSpace(razorpayOptions.KeyId))
    razorpayOptions.KeyId = builder.Configuration["RAZORPAY_KEY_ID"] ?? "";
if (string.IsNullOrWhiteSpace(razorpayOptions.KeySecret))
    razorpayOptions.KeySecret = builder.Configuration["RAZORPAY_KEY_SECRET"] ?? "";
builder.Services.AddSingleton(razorpayOptions);
// A short timeout keeps a slow gateway from holding a checkout request open indefinitely.
builder.Services.AddHttpClient<IRazorpayGateway, RazorpayGateway>(c => c.Timeout = TimeSpan.FromSeconds(20));
var emailOptions = builder.Configuration.GetSection("Email").Get<EmailOptions>() ?? new EmailOptions();
builder.Services.AddSingleton(emailOptions);
builder.Services.AddSingleton<IEmailService, EmailService>();
var jwt = builder.Configuration.GetSection("Jwt");
var signingKey = jwt["SigningKey"] ?? throw new InvalidOperationException("Jwt:SigningKey is required.");
if (signingKey.Length < 32) throw new InvalidOperationException("Jwt:SigningKey must be at least 32 characters.");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = true, ValidIssuer = jwt["Issuer"], ValidateAudience = true, ValidAudience = jwt["Audience"], ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), ValidateLifetime = true, ClockSkew = TimeSpan.FromMinutes(1) };
    o.Events = new JwtBearerEvents
    {
        OnTokenValidated = async context =>
        {
            var sessions = context.HttpContext.RequestServices.GetRequiredService<AppSessionService>();
            if (context.Principal is null || !await sessions.ValidatePrincipalAsync(context.Principal, context.HttpContext.RequestAborted))
                context.Fail("App session revoked.");
        }
    };
});
builder.Services.AddAuthorization(o => o.AddPolicy("AdminOnly", p => p.RequireRole("Admin")));
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    if (builder.Environment.IsDevelopment())
        p.WithOrigins("http://localhost:4200").AllowCredentials().AllowAnyHeader().AllowAnyMethod();
    else
        p.WithOrigins("https://bathany.com", "https://www.bathany.com").AllowAnyHeader().AllowAnyMethod();
}));

var app = builder.Build();
app.UseForwardedHeaders();
if (app.Configuration["Database:Provider"] == "InMemory")
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<ShopDbContext>().Database.EnsureCreated();
}
await SeedProductImagesAsync(app);
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }
app.UseStaticFiles();
app.UseCors(); app.UseAuthentication(); app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health");
app.MapHealthChecks("/ready");
// Serve the built Angular SPA from the API so the whole app lives on one origin.
// Any non-API path that is not a real file falls back to index.html for client-side routing.
app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api")) { context.Response.StatusCode = 404; return; }
    var index = Path.Combine(app.Environment.WebRootPath, "index.html");
    if (!File.Exists(index)) { context.Response.StatusCode = 404; return; }
    context.Response.ContentType = "text/html";
    context.Response.Headers.CacheControl = "no-cache";
    await context.Response.SendFileAsync(index);
});
app.Run();

/// <summary>
/// Loads the packaged brand images into the database once, then points the seeded products at them,
/// so every product image is served from the database rather than the frontend bundle.
/// </summary>
static async Task SeedProductImagesAsync(WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ShopDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("ProductImageSeed");
    var folder = Path.Combine(app.Environment.ContentRootPath, "SeedImages");
    if (!Directory.Exists(folder)) { logger.LogWarning("Seed image folder {Folder} not found; skipping.", folder); return; }

    foreach (var product in await db.Products.OrderBy(p => p.Id).ToListAsync())
    {
        // Only replace bundle-relative paths; never overwrite an image an admin has already uploaded.
        if (!product.ImageUrl.StartsWith("assets/", StringComparison.OrdinalIgnoreCase)) continue;
        var file = Path.Combine(folder, $"product-{product.Id}.jpeg");
        if (!File.Exists(file)) continue;

        var name = $"seed-product-{product.Id}.jpeg";
        var image = await db.ProductImages.FirstOrDefaultAsync(i => i.FileName == name);
        if (image is null)
        {
            var bytes = await File.ReadAllBytesAsync(file);
            image = new ProductImage { FileName = name, ContentType = "image/jpeg", Content = bytes, Length = bytes.Length };
            db.ProductImages.Add(image);
            await db.SaveChangesAsync();
        }
        product.ImageUrl = $"/api/catalog/images/{image.Id}";
    }
    await db.SaveChangesAsync();
}
