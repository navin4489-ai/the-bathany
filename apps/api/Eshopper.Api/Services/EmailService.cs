using System.Net;
using System.Net.Mail;
using System.Text;
using Eshopper.Api.Domain;

namespace Eshopper.Api.Services;

/// <summary>SMTP settings. When <see cref="Host"/> or credentials are blank the service stays disabled.</summary>
public class EmailOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string UserName { get; set; } = "";
    public string Password { get; set; } = "";
    /// <summary>Address shoppers see in the From field.</summary>
    public string FromAddress { get; set; } = "donotreply@bathany.com";
    public string FromName { get; set; } = "The Bathany";
    /// <summary>Where replies go, since the From address is unattended.</summary>
    public string ReplyTo { get; set; } = "";
    /// <summary>Comma-separated admin recipients for new-order alerts.</summary>
    public string AdminRecipients { get; set; } = "";
    public bool UseStartTls { get; set; } = true;
    public string StoreUrl { get; set; } = "https://bathany.com";
}

public interface IEmailService
{
    bool Enabled { get; }
    Task SendOrderPlacedAsync(Order order, string customerEmail, CancellationToken ct = default);
    Task SendOrderStatusAsync(Order order, string customerEmail, string previousStatus, CancellationToken ct = default);
}

/// <summary>
/// Sends transactional order mail over SMTP. Delivery failures are logged and swallowed:
/// a mail outage must never fail a checkout that has already taken the shopper's money.
/// </summary>
public class EmailService(EmailOptions options, ILogger<EmailService> logger) : IEmailService
{
    public bool Enabled =>
        !string.IsNullOrWhiteSpace(options.Host) &&
        !string.IsNullOrWhiteSpace(options.UserName) &&
        !string.IsNullOrWhiteSpace(options.Password);

    private static readonly Dictionary<string, string> StatusBlurbs = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Paid"] = "We have received your payment and your order is being prepared.",
        ["Processing"] = "Your order is being packed with care.",
        ["Shipped"] = "Good news — your order is on its way to you.",
        ["Delivered"] = "Your order has been delivered. We hope you love it.",
        ["Cancelled"] = "Your order has been cancelled. Any payment taken will be refunded.",
        ["Refunded"] = "Your refund has been issued and should reach you in 5-7 working days.",
        ["PaymentFailed"] = "We could not confirm payment for this order, so it has not been placed."
    };

    public Task SendOrderPlacedAsync(Order order, string customerEmail, CancellationToken ct = default)
    {
        if (!Enabled) return Task.CompletedTask;
        var subject = $"Your Bathany order #{order.Id} is confirmed";
        var body = Layout($"Thank you for your order, {Escape(FirstName(order))}!",
            $"<p style=\"{MutedStyle}\">We have received your order and payment. Here is what is on its way to you.</p>" +
            OrderTable(order) + AddressBlock(order) +
            $"<p><a href=\"{options.StoreUrl}/orders\" style=\"{BtnStyle}\">View my orders</a></p>");
        var adminBody = Layout($"New order #{order.Id}",
            $"<p style=\"{MutedStyle}\">A new order was placed by <strong>{Escape(customerEmail)}</strong>.</p>" +
            OrderTable(order) + AddressBlock(order) +
            $"<p><a href=\"{options.StoreUrl}/admin\" style=\"{BtnStyle}\">Open the admin panel</a></p>");

        return Task.WhenAll(
            SendAsync(customerEmail, subject, body, ct),
            SendToAdminsAsync($"New Bathany order #{order.Id} — {order.Total:C0}", adminBody, ct));
    }

    public Task SendOrderStatusAsync(Order order, string customerEmail, string previousStatus, CancellationToken ct = default)
    {
        if (!Enabled) return Task.CompletedTask;
        var blurb = StatusBlurbs.TryGetValue(order.Status, out var text) ? text : $"Your order status is now {order.Status}.";
        var body = Layout($"Your order #{order.Id} is now {Escape(order.Status)}",
            $"<p style=\"{MutedStyle}\">Hello {Escape(FirstName(order))},</p><p style=\"{MutedStyle}\">{Escape(blurb)}</p>" +
            $"<p style=\"{MutedStyle}\">Status changed from {Escape(previousStatus)} to <strong>{Escape(order.Status)}</strong>.</p>" +
            OrderTable(order) +
            $"<p><a href=\"{options.StoreUrl}/orders\" style=\"{BtnStyle}\">Track my order</a></p>");
        return SendAsync(customerEmail, $"Update on your Bathany order #{order.Id}: {order.Status}", body, ct);
    }

    private static string FirstName(Order order)
    {
        var name = order.ShippingAddress?.FullName ?? order.User?.DisplayName ?? "";
        var first = name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return string.IsNullOrWhiteSpace(first) ? "there" : first;
    }

    private Task SendToAdminsAsync(string subject, string body, CancellationToken ct)
    {
        var admins = options.AdminRecipients.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (admins.Length == 0) return Task.CompletedTask;
        return Task.WhenAll(admins.Select(a => SendAsync(a, subject, body, ct)));
    }

    private async Task SendAsync(string to, string subject, string html, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(to)) return;
        try
        {
            using var client = new SmtpClient(options.Host, options.Port)
            {
                EnableSsl = options.UseStartTls,
                Credentials = new NetworkCredential(options.UserName, options.Password),
                DeliveryMethod = SmtpDeliveryMethod.Network
            };
            using var message = new MailMessage
            {
                From = new MailAddress(options.FromAddress, options.FromName),
                Subject = subject,
                Body = html,
                IsBodyHtml = true,
                BodyEncoding = Encoding.UTF8,
                SubjectEncoding = Encoding.UTF8
            };
            message.To.Add(to);
            if (!string.IsNullOrWhiteSpace(options.ReplyTo)) message.ReplyToList.Add(new MailAddress(options.ReplyTo));
            await client.SendMailAsync(message, ct);
            logger.LogInformation("Sent \"{Subject}\" to {Recipient}.", subject, to);
        }
        catch (Exception ex)
        {
            // Never rethrow: the order is already committed and paid for.
            logger.LogError(ex, "Could not send \"{Subject}\" to {Recipient}.", subject, to);
        }
    }

    private string OrderTable(Order order)
    {
        var rows = new StringBuilder();
        foreach (var item in order.Items)
            rows.Append($"<tr><td style=\"{CellStyle}\">{Escape(item.ProductName)} × {item.Quantity}</td><td align=\"right\" style=\"{CellStyle}\">₹{item.UnitPrice * item.Quantity:N2}</td></tr>");
        rows.Append($"<tr><td style=\"{CellStyle}\"><strong>Total</strong></td><td align=\"right\" style=\"{CellStyle}\"><strong>₹{order.Total:N2}</strong></td></tr>");
        return $"<table width=\"100%\" cellpadding=\"8\" cellspacing=\"0\" style=\"border-collapse:collapse;margin:16px 0;\">{rows}</table>";
    }

    private static string AddressBlock(Order order)
    {
        var a = order.ShippingAddress;
        if (a is null) return "";
        var line2 = string.IsNullOrWhiteSpace(a.Line2) ? "" : $", {Escape(a.Line2)}";
        var landmark = string.IsNullOrWhiteSpace(a.Landmark) ? "" : $"{Escape(a.Landmark)}<br>";
        return $"<p style=\"{MutedStyle}\"><strong>Delivering to</strong><br>" +
               $"{Escape(a.FullName)} · {Escape(a.Phone)}<br>{Escape(a.Line1)}{line2}<br>{landmark}" +
               $"{Escape(a.City)}, {Escape(a.State)} {Escape(a.PostalCode)}<br>{Escape(a.Country)}</p>";
    }

    private const string Serif = "font-family:Georgia,'Times New Roman',serif;";
    private const string MutedStyle = "color:#7a6a5e;font-size:14px;line-height:1.6;";
    private const string BtnStyle = "display:inline-block;background:#7a5c48;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-size:15px;";
    private const string CellStyle = "border-bottom:1px solid #eee4dc;font-size:14px;color:#3b2f28;";

    private string Layout(string heading, string content) => $"""
        <!doctype html>
        <html><body style="margin:0;padding:0;background:#f6f1ec;">
        <div style="max-width:560px;margin:0 auto;padding:24px;{Serif}color:#3b2f28;">
          <div style="background:#ffffff;border-radius:12px;padding:28px;">
            <h1 style="font-size:22px;margin:0 0 16px;{Serif}">{heading}</h1>
            {content}
          </div>
          <p style="text-align:center;font-size:12px;color:#9c8b7e;padding-top:16px;{Serif}">
            The Bathany · This mailbox is not monitored.<br>
            <a href="{options.StoreUrl}" style="color:#9c8b7e;">{options.StoreUrl}</a>
          </p>
        </div>
        </body></html>
        """;

    private static string Escape(string? value) => WebUtility.HtmlEncode(value ?? "");
}
