using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Eshopper.Api.Services;

public class RazorpayOptions
{
    public string KeyId { get; set; } = "";
    public string KeySecret { get; set; } = "";
    /// <summary>Set false to keep the simulated gateway as the only option (for example in automated tests).</summary>
    public bool Enabled { get; set; } = true;
    public string Currency { get; set; } = "INR";
    /// <summary>Optional webhook secret; only used when a webhook endpoint is configured in the Razorpay dashboard.</summary>
    public string WebhookSecret { get; set; } = "";
}

public record RazorpayOrder(string Id, long AmountMinor, string Currency);
public class RazorpayApiException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

/// <summary>
/// Outcome of verifying a Razorpay callback. <see cref="Captured"/> distinguishes a payment that
/// has actually taken the money from one that is merely authorized and awaiting capture.
/// </summary>
public record RazorpayVerification(
    bool Success,
    string Error,
    string PaymentId,
    string OrderId,
    string Method,
    string CardBrand,
    string CardLast4,
    long AmountMinor,
    string Currency,
    bool Captured,
    string ProviderStatus);

public interface IRazorpayGateway
{
    bool Enabled { get; }
    bool IsTestMode { get; }
    string KeyId { get; }
    Task<RazorpayOrder> CreateOrderAsync(decimal amount, string receipt, IDictionary<string, string>? notes, CancellationToken ct = default);
    Task<RazorpayVerification> VerifyAsync(string razorpayOrderId, string razorpayPaymentId, string signature, decimal? expectedAmount, int userId, CancellationToken ct = default);
}

/// <summary>
/// Talks to the Razorpay REST API. The amount is always taken from our own database and
/// re-checked against the amount Razorpay reports, so a tampered client cannot pay less
/// than the order is worth.
/// </summary>
public class RazorpayGateway(HttpClient http, RazorpayOptions options, ILogger<RazorpayGateway> logger) : IRazorpayGateway
{
    public bool Enabled => options.Enabled && !string.IsNullOrWhiteSpace(options.KeyId) && !string.IsNullOrWhiteSpace(options.KeySecret);
    public bool IsTestMode => options.KeyId.StartsWith("rzp_test_", StringComparison.Ordinal);
    public string KeyId => options.KeyId;

    private AuthenticationHeaderValue BasicAuth() =>
        new("Basic", Convert.ToBase64String(Encoding.ASCII.GetBytes($"{options.KeyId}:{options.KeySecret}")));

    /// <summary>Rupees to paise. Razorpay works in the smallest currency unit and rejects fractions.</summary>
    private static long ToMinorUnits(decimal amount) => (long)decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero);

    public async Task<RazorpayOrder> CreateOrderAsync(decimal amount, string receipt, IDictionary<string, string>? notes, CancellationToken ct = default)
    {
        if (!Enabled) throw new InvalidOperationException("Razorpay is not configured.");
        if (amount < 1m) throw new InvalidOperationException("Minimum payment amount is 100 paise (INR 1).");

        var payload = new Dictionary<string, object>
        {
            ["amount"] = ToMinorUnits(amount),
            ["currency"] = options.Currency,
            // Razorpay caps receipts at 40 characters and rejects anything longer.
            ["receipt"] = receipt.Length > 40 ? receipt[..40] : receipt,
            ["payment_capture"] = 1
        };
        if (notes is { Count: > 0 }) payload["notes"] = notes;

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.razorpay.com/v1/orders")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = BasicAuth();

        using var response = await http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogError("Razorpay order creation failed ({Status}): {Body}", (int)response.StatusCode, body);
            throw new RazorpayApiException("Could not start the payment. Please contact support or try again.",
                response.StatusCode == System.Net.HttpStatusCode.Unauthorized ? 401 : 500);
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        return new RazorpayOrder(
            root.GetProperty("id").GetString() ?? "",
            root.TryGetProperty("amount", out var a) ? a.GetInt64() : ToMinorUnits(amount),
            root.TryGetProperty("currency", out var c) ? c.GetString() ?? options.Currency : options.Currency);
    }

    public async Task<RazorpayVerification> VerifyAsync(string razorpayOrderId, string razorpayPaymentId, string signature, decimal? expectedAmount, int userId, CancellationToken ct = default)
    {
        if (!Enabled) return Failed("Razorpay is not configured.");
        if (string.IsNullOrWhiteSpace(razorpayOrderId) || string.IsNullOrWhiteSpace(razorpayPaymentId) || string.IsNullOrWhiteSpace(signature))
            return Failed("The payment confirmation was incomplete. No charge was recorded.");

        // 1. The signature proves the callback really came from Razorpay and was not forged by the browser.
        if (!SignatureIsValid(razorpayOrderId, razorpayPaymentId, signature))
        {
            logger.LogWarning("Rejected Razorpay callback with an invalid signature for order {OrderId}.", razorpayOrderId);
            return Failed("Invalid payment signature. No order was created. If money was deducted, contact support.");
        }

        // Retrieve the server-created order; never accept a different shopper's order or amount.
        using var orderRequest = new HttpRequestMessage(HttpMethod.Get, $"https://api.razorpay.com/v1/orders/{Uri.EscapeDataString(razorpayOrderId)}");
        orderRequest.Headers.Authorization = BasicAuth();
        using var orderResponse = await http.SendAsync(orderRequest, ct);
        if (!orderResponse.IsSuccessStatusCode)
            throw new RazorpayApiException("Could not retrieve the payment order. Please contact support.",
                orderResponse.StatusCode == System.Net.HttpStatusCode.Unauthorized ? 401 : 500);
        using var orderDoc = JsonDocument.Parse(await orderResponse.Content.ReadAsStringAsync(ct));
        var orderRoot = orderDoc.RootElement;
        if (!orderRoot.TryGetProperty("notes", out var notes) || notes.ValueKind != JsonValueKind.Object ||
            !notes.TryGetProperty("userId", out var owner) || owner.ValueKind != JsonValueKind.String ||
            owner.GetString() != userId.ToString(CultureInfo.InvariantCulture))
            return Failed("This payment order does not belong to your account.");
        var orderAmount = orderRoot.GetProperty("amount").GetInt64();
        var orderCurrency = orderRoot.GetProperty("currency").GetString();
        if (orderAmount < 100 || orderCurrency != options.Currency ||
            (expectedAmount is { } total && orderAmount != ToMinorUnits(total)))
            return Failed("The payment order amount or currency does not match the checkout.");

        // 2. Ask Razorpay directly what happened. The browser is never trusted for status or amount.
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.razorpay.com/v1/payments/{Uri.EscapeDataString(razorpayPaymentId)}");
        request.Headers.Authorization = BasicAuth();
        using var response = await http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogError("Razorpay payment fetch failed ({Status}): {Body}", (int)response.StatusCode, body);
            throw new RazorpayApiException("We could not confirm this payment with the payment provider. Please contact support before retrying.",
                response.StatusCode == System.Net.HttpStatusCode.Unauthorized ? 401 : 500);
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var status = root.TryGetProperty("status", out var s) ? s.GetString() ?? "" : "";
        var amountMinor = root.TryGetProperty("amount", out var am) ? am.GetInt64() : 0;
        var currency = root.TryGetProperty("currency", out var cu) ? cu.GetString() ?? options.Currency : options.Currency;
        var paidOrderId = root.TryGetProperty("order_id", out var oi) ? oi.GetString() ?? "" : "";

        // 3. The payment must belong to the order we started, or someone is replaying another payment.
        if (!string.Equals(paidOrderId, razorpayOrderId, StringComparison.Ordinal))
        {
            logger.LogWarning("Razorpay payment {PaymentId} belongs to order {Actual}, not {Expected}.", razorpayPaymentId, paidOrderId, razorpayOrderId);
            return Failed("This payment does not match the order. No order was created.");
        }

        // 4. The amount must match what we asked for, to the paisa.
        var expectedMinor = orderAmount;
        if (amountMinor != expectedMinor || currency != orderCurrency)
        {
            logger.LogWarning("Razorpay amount mismatch on {PaymentId}: paid {Paid}, expected {Expected}.", razorpayPaymentId, amountMinor, expectedMinor);
            return Failed("The amount paid did not match the order total. No order was created.");
        }

        if (status is not ("captured" or "authorized"))
            return Failed(status == "failed"
                ? DescribeFailure(root)
                : $"The payment is not complete (status: {status}). Please try again.");

        var card = root.TryGetProperty("card", out var cd) && cd.ValueKind == JsonValueKind.Object ? cd : default;
        var brand = card.ValueKind == JsonValueKind.Object && card.TryGetProperty("network", out var n) ? n.GetString() ?? "" : "";
        var last4 = card.ValueKind == JsonValueKind.Object && card.TryGetProperty("last4", out var l4) ? l4.GetString() ?? "" : "";
        var method = root.TryGetProperty("method", out var m) ? m.GetString() ?? "card" : "card";

        return new RazorpayVerification(true, "", razorpayPaymentId, razorpayOrderId, method, brand, last4,
            amountMinor, currency, status == "captured", status);
    }

    /// <summary>HMAC-SHA256 of "order_id|payment_id" keyed with the API secret, per Razorpay's spec.</summary>
    private bool SignatureIsValid(string orderId, string paymentId, string signature)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(options.KeySecret));
        var computed = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{orderId}|{paymentId}")))
            .ToLower(CultureInfo.InvariantCulture);
        // Fixed-time comparison: a length-sensitive or early-exit compare leaks the expected signature.
        var provided = signature.Trim().ToLower(CultureInfo.InvariantCulture);
        if (computed.Length != provided.Length) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(computed), Encoding.ASCII.GetBytes(provided));
    }

    private static RazorpayVerification Failed(string error) =>
        new(false, error, "", "", "", "", "", 0, "INR", false, "failed");

    private static string DescribeFailure(JsonElement payment) =>
        payment.TryGetProperty("error_description", out var d) && d.ValueKind == JsonValueKind.String
            ? d.GetString()!
            : "The payment was not successful. Please try another method.";

    private static string DescribeError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var e) && e.TryGetProperty("description", out var d))
                return d.GetString() ?? "the payment provider rejected the request";
        }
        catch (JsonException) { /* fall through to the generic message */ }
        return "the payment provider rejected the request";
    }
}
