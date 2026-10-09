using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Eshopper.Api.Services;
public record ProductDto(int Id, string Name, string Description, decimal Price, int Stock, string ImageUrl, int CategoryId);
public record CartLine(int ProductId, int Quantity);
public record CheckoutRequest(IReadOnlyList<CartLine> Items, string IdempotencyKey, string? PaymentToken = null, string? PaymentMethod = null, CardDetails? Card = null, ShippingAddressRequest? ShippingAddress = null, RazorpayConfirmation? Razorpay = null);
/// <summary>Values handed back by the Razorpay checkout widget; all three are required to verify a payment.</summary>
public record RazorpayConfirmation(string? OrderId = null, string? PaymentId = null, string? Signature = null);
public record ShippingAddressRequest(string? FullName = null, string? Phone = null, string? Line1 = null, string? Line2 = null, string? City = null, string? State = null, string? PostalCode = null, string? Country = null, string? Landmark = null);
public interface ICatalogService { Task<IReadOnlyList<ProductDto>> GetProducts(string? search, int? categoryId); Task<ProductDto?> GetProduct(int id); }
public class CatalogService(ShopDbContext db) : ICatalogService
{
    public async Task<IReadOnlyList<ProductDto>> GetProducts(string? search, int? categoryId) => await db.Products.AsNoTracking().Where(p => p.IsActive && (search == null || p.Name.Contains(search)) && (categoryId == null || p.CategoryId == categoryId)).Select(p => new ProductDto(p.Id, p.Name, p.Description, p.Price, p.Stock, p.ImageUrl, p.CategoryId)).ToListAsync();
    public async Task<ProductDto?> GetProduct(int id) => await db.Products.AsNoTracking().Where(p => p.Id == id).Select(p => new ProductDto(p.Id, p.Name, p.Description, p.Price, p.Stock, p.ImageUrl, p.CategoryId)).SingleOrDefaultAsync();
}
public record CardDetails(string? Number = null, string? HolderName = null, string? Expiry = null, string? Cvv = null);
public record PaymentRequest(string Method, string? PaymentToken, CardDetails? Card);
public record PaymentResult(bool Success, string Status, string TransactionId, string Method, string CardBrand, string CardLast4, string FailureReason);
public record PaymentMethodInfo(string Code, string Label, string Description, bool RequiresCard);
public record TestCardInfo(string Number, string Outcome, string Description);

public interface IPaymentGateway
{
    PaymentResult Charge(decimal amount, PaymentRequest request);
    IReadOnlyList<PaymentMethodInfo> Methods { get; }
    IReadOnlyList<TestCardInfo> TestCards { get; }
}

/// <summary>Simulated gateway for testing. Deterministic outcomes, never contacts a real processor.</summary>
public class DummyPaymentGateway : IPaymentGateway
{
    public const string Card = "card";
    public const string Wallet = "wallet";
    public const string CashOnDelivery = "cod";

    public IReadOnlyList<PaymentMethodInfo> Methods { get; } =
    [
        new(Card, "Credit / Debit Card", "Pay securely with a test card.", true),
        new(Wallet, "Bathany Wallet", "Instant simulated wallet debit.", false),
        new(CashOnDelivery, "Cash on Delivery", "Pay in cash when your order arrives.", false)
    ];

    public IReadOnlyList<TestCardInfo> TestCards { get; } =
    [
        new("4242424242424242", "Approved", "Visa - payment succeeds"),
        new("5555555555554444", "Approved", "Mastercard - payment succeeds"),
        new("4000000000000002", "Declined", "Card declined by issuer"),
        new("4000000000009995", "Declined", "Insufficient funds"),
        new("4000000000000119", "Error", "Gateway processing error")
    ];

    public PaymentResult Charge(decimal amount, PaymentRequest request)
    {
        var method = (request.Method ?? Card).Trim().ToLowerInvariant();
        if (Methods.All(m => m.Code != method)) return Fail(method, "", "", "Unsupported payment method.");

        if (method == Wallet) return new PaymentResult(true, "Approved", Reference("WLT"), method, "", "", "");
        if (method == CashOnDelivery) return new PaymentResult(true, "Pending", Reference("COD"), method, "", "", "");

        // Legacy token support keeps earlier automated tests working.
        if (request.Card is null && !string.IsNullOrWhiteSpace(request.PaymentToken))
            return request.PaymentToken switch
            {
                "test_approved" => new PaymentResult(true, "Approved", $"DUMMY-{amount:0.00}-APPROVED", method, "Test", "0000", ""),
                "test_declined" => Fail(method, "Test", "0000", "Card declined by issuer."),
                "test_error" => throw new InvalidOperationException("Deterministic test gateway error."),
                _ => Fail(method, "", "", "Invalid payment token.")
            };

        var card = request.Card;
        if (card is null) return Fail(method, "", "", "Card details are required.");

        var digits = new string((card.Number ?? "").Where(char.IsDigit).ToArray());
        if (string.IsNullOrWhiteSpace(card.HolderName)) return Fail(method, "", "", "Cardholder name is required.");
        if (digits.Length is < 13 or > 19 || !PassesLuhn(digits)) return Fail(method, "", Last4(digits), "Invalid card number.");
        if (!IsFutureExpiry(card.Expiry)) return Fail(method, Brand(digits), Last4(digits), "Card has expired or the expiry date is invalid.");
        if ((card.Cvv ?? "").Length is < 3 or > 4 || !(card.Cvv ?? "").All(char.IsDigit)) return Fail(method, Brand(digits), Last4(digits), "Invalid security code.");

        var brand = Brand(digits);
        var last4 = Last4(digits);
        return digits switch
        {
            "4000000000000119" => throw new InvalidOperationException("Simulated gateway processing error. No charge was made."),
            "4000000000000002" => Fail(method, brand, last4, "Card declined by issuer."),
            "4000000000009995" => Fail(method, brand, last4, "Insufficient funds."),
            _ => new PaymentResult(true, "Approved", Reference("TXN"), method, brand, last4, "")
        };
    }

    private static PaymentResult Fail(string method, string brand, string last4, string reason) =>
        new(false, "Declined", Reference("DEC"), method, brand, last4, reason);

    private static string Reference(string prefix) => $"{prefix}-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}";

    private static string Last4(string digits) => digits.Length >= 4 ? digits[^4..] : "";

    private static string Brand(string digits) => digits switch
    {
        _ when digits.StartsWith('4') => "Visa",
        _ when digits.Length > 1 && digits[0] == '5' && digits[1] is >= '1' and <= '5' => "Mastercard",
        _ when digits.StartsWith("34") || digits.StartsWith("37") => "American Express",
        _ when digits.StartsWith("6") => "Discover",
        _ => "Card"
    };

    private static bool IsFutureExpiry(string? expiry)
    {
        var parts = (expiry ?? "").Split('/', StringSplitOptions.TrimEntries);
        if (parts.Length != 2 || !int.TryParse(parts[0], out var month) || !int.TryParse(parts[1], out var year)) return false;
        if (month is < 1 or > 12) return false;
        if (year < 100) year += 2000;
        var now = DateTime.UtcNow;
        return year > now.Year || (year == now.Year && month >= now.Month);
    }

    private static bool PassesLuhn(string digits)
    {
        var sum = 0; var alternate = false;
        for (var i = digits.Length - 1; i >= 0; i--)
        {
            var n = digits[i] - '0';
            if (alternate) { n *= 2; if (n > 9) n -= 9; }
            sum += n; alternate = !alternate;
        }
        return sum % 10 == 0;
    }
}
public interface ICheckoutService { Task<(Order? Order, string? Error)> Checkout(int userId, CheckoutRequest request); }
public class CheckoutService(ShopDbContext db, IPaymentGateway gateway, IRazorpayGateway razorpay, IEmailService email, IWebHostEnvironment environment) : ICheckoutService
{
    public const string RazorpayMethod = "razorpay";

    public async Task<(Order? Order, string? Error)> Checkout(int userId, CheckoutRequest request)
    {
        if (request.Items is null || request.Items.Count == 0 || string.IsNullOrWhiteSpace(request.IdempotencyKey)) return (null, "Items and IdempotencyKey are required.");
        if (ValidateAddress(request.ShippingAddress) is { } addressError) return (null, addressError);
        var existing = await db.Orders.Include(o => o.Payment).Include(o => o.Items).Include(o => o.ShippingAddress).SingleOrDefaultAsync(o => o.UserId == userId && o.IdempotencyKey == request.IdempotencyKey);
        if (existing is not null) return (existing, null);
        var products = await db.Products.Where(p => request.Items.Select(i => i.ProductId).Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        if (products.Count != request.Items.Select(i => i.ProductId).Distinct().Count() ||
            request.Items.Any(i => i.Quantity < 1 || !products[i.ProductId].IsActive) ||
            request.Items.GroupBy(i => i.ProductId).Any(g => products[g.Key].Stock < g.Sum(i => (long)i.Quantity)))
            return (null, "Product unavailable or invalid quantity.");

        var method = (request.PaymentMethod ?? DummyPaymentGateway.Card).Trim().ToLowerInvariant();
        var isRazorpay = method == RazorpayMethod;
        // Already-started Razorpay sessions must still finalize after an admin disables new payments.
        if (!isRazorpay && !await db.PaymentOptions.AsNoTracking().Where(x => x.Code == RazorpayMethod).Select(x => x.Enabled).SingleAsync())
            return (null, "Payments are temporarily disabled. Please try again later.");
        if (isRazorpay && !razorpay.Enabled) return (null, "Online payment is temporarily unavailable. Please choose another method.");
        // Once Razorpay is live it is the only accepted method; the simulated gateway is a
        // development fallback and must not be reachable by crafting a request.
        if (!isRazorpay && (razorpay.Enabled || !environment.IsDevelopment()))
            return (null, "Please pay online to complete your order.");

        // The total is always recomputed here from current database prices, so the amount verified
        // against the gateway is our figure and never one supplied by the browser.
        var total = request.Items.Sum(line => products[line.ProductId].Price * line.Quantity);
        if (isRazorpay && total < 1m) return (null, "Minimum payment amount is 100 paise (INR 1).");

        // A Razorpay payment is confirmed with the provider *before* any stock is touched, so a
        // failed verification cannot leave reserved stock or a half-finished order behind.
        RazorpayVerification? verified = null;
        if (isRazorpay)
        {
            var confirmation = request.Razorpay;
            if (confirmation is null) return (null, "The payment confirmation was missing. No charge was recorded.");
            // Guard against a replayed payment being used to claim a second order.
            if (await db.Payments.AnyAsync(p => p.ProviderPaymentId == confirmation.PaymentId))
                return (null, "This payment has already been used for another order.");
            try
            {
                verified = await razorpay.VerifyAsync(confirmation.OrderId ?? "", confirmation.PaymentId ?? "", confirmation.Signature ?? "", total, userId);
            }
            catch (RazorpayApiException ex)
            {
                return (null, ex.Message);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                return (null, "We could not reach the payment provider to confirm your payment. Please contact support before retrying.");
            }
            if (!verified.Success) return (null, verified.Error);
        }

        await using var tx = await db.Database.BeginTransactionAsync();
        var order = new Order { UserId = userId, IdempotencyKey = request.IdempotencyKey };
        var a = request.ShippingAddress!;
        order.ShippingAddress = new ShippingAddress
        {
            FullName = a.FullName!.Trim(), Phone = a.Phone!.Trim(), Line1 = a.Line1!.Trim(),
            Line2 = a.Line2?.Trim() ?? "", City = a.City!.Trim(), State = a.State!.Trim(),
            PostalCode = a.PostalCode!.Trim(), Country = string.IsNullOrWhiteSpace(a.Country) ? "India" : a.Country.Trim(),
            Landmark = a.Landmark?.Trim() ?? ""
        };
        foreach (var line in request.Items) { var p = products[line.ProductId]; p.Stock -= line.Quantity; order.Items.Add(new OrderItem { ProductId = p.Id, ProductName = p.Name, UnitPrice = p.Price, Quantity = line.Quantity }); order.Total += p.Price * line.Quantity; }

        if (verified is not null)
        {
            order.Status = verified.Captured ? "Paid" : "AwaitingPayment";
            order.Payment = new Payment
            {
                Amount = order.Total,
                Status = verified.Captured ? "Approved" : "Authorized",
                TransactionId = verified.PaymentId,
                Method = verified.Method,
                CardBrand = verified.CardBrand,
                CardLast4 = verified.CardLast4,
                FailureReason = "",
                Provider = RazorpayMethod,
                ProviderOrderId = verified.OrderId,
                ProviderPaymentId = verified.PaymentId,
                Currency = verified.Currency
            };
            db.AuditActivities.Add(new AuditActivity { UserId = userId, Action = "Checkout", Details = $"Order total {order.Total:0.00} via Razorpay {verified.Method} ({verified.ProviderStatus}) ref {verified.PaymentId}" });
        }
        else
        {
            PaymentResult result;
            try { result = gateway.Charge(order.Total, new PaymentRequest(method, request.PaymentToken, request.Card)); }
            catch (InvalidOperationException ex) { await tx.RollbackAsync(); return (null, ex.Message); }

            if (!result.Success)
            {
                // Release the reserved stock, but keep the failed order for the audit trail.
                foreach (var line in request.Items) products[line.ProductId].Stock += line.Quantity;
                order.Status = "PaymentFailed";
            }
            else order.Status = result.Status == "Pending" ? "AwaitingPayment" : "Paid";

            order.Payment = new Payment { Amount = order.Total, Status = result.Status, TransactionId = result.TransactionId, Method = result.Method, CardBrand = result.CardBrand, CardLast4 = result.CardLast4, FailureReason = result.FailureReason, Provider = "simulated" };
            db.AuditActivities.Add(new AuditActivity { UserId = userId, Action = "Checkout", Details = $"Order total {order.Total:0.00} via {result.Method} ({result.Status})" });
        }

        db.Orders.Add(order);
        await db.SaveChangesAsync(); await tx.CommitAsync();

        // Confirmation mail is best-effort and deliberately after the commit: a mail failure
        // must never roll back an order the shopper has already paid for.
        if (order.Status is "Paid" or "AwaitingPayment")
        {
            var customerEmail = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).SingleOrDefaultAsync();
            if (!string.IsNullOrWhiteSpace(customerEmail)) await email.SendOrderPlacedAsync(order, customerEmail);
        }
        return (order, null);
    }

    /// <summary>Delivery details are mandatory: an order that cannot be shipped must never be charged.</summary>
    public static string? ValidateAddress(ShippingAddressRequest? a)
    {
        if (a is null) return "A shipping address is required.";
        if (string.IsNullOrWhiteSpace(a.FullName)) return "Recipient name is required.";
        var phone = new string((a.Phone ?? "").Where(char.IsDigit).ToArray());
        if (phone.Length != 10) return "Enter a valid 10-digit phone number.";
        if (string.IsNullOrWhiteSpace(a.Line1)) return "Address line 1 is required.";
        if (string.IsNullOrWhiteSpace(a.City)) return "City is required.";
        if (string.IsNullOrWhiteSpace(a.State)) return "State is required.";
        var pin = (a.PostalCode ?? "").Trim();
        if (pin.Length != 6 || !pin.All(char.IsDigit) || pin[0] == '0') return "Enter a valid 6-digit PIN code.";
        return null;
    }
}
