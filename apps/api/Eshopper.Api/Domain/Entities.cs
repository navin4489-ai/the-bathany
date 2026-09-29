namespace Eshopper.Api.Domain;

public class User { public int Id { get; set; } public string Email { get; set; } = ""; public string DisplayName { get; set; } = ""; public string PasswordHash { get; set; } = ""; public string Role { get; set; } = "Customer"; public DateTime CreatedAt { get; set; } = DateTime.UtcNow; }
public class Category { public int Id { get; set; } public string Name { get; set; } = ""; public ICollection<Product> Products { get; set; } = []; }
public class Product { public int Id { get; set; } public string Name { get; set; } = ""; public string Description { get; set; } = ""; public decimal Price { get; set; } public int Stock { get; set; } public string ImageUrl { get; set; } = ""; public bool IsActive { get; set; } = true; public int CategoryId { get; set; } public Category? Category { get; set; } }
/// <summary>Product image bytes held in the database so uploads survive restarts and scale across instances.</summary>
public class ProductImage
{
    public int Id { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public byte[] Content { get; set; } = [];
    public long Length { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public int? UploadedByUserId { get; set; }
}
public class Order { public int Id { get; set; } public int UserId { get; set; } public User? User { get; set; } public string IdempotencyKey { get; set; } = ""; public decimal Total { get; set; } public string Status { get; set; } = "Pending"; public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public ICollection<OrderItem> Items { get; set; } = []; public Payment? Payment { get; set; } public ShippingAddress? ShippingAddress { get; set; } }
/// <summary>Delivery address snapshotted per order, so later profile edits never rewrite shipping history.</summary>
public class ShippingAddress
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Line1 { get; set; } = "";
    public string Line2 { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string PostalCode { get; set; } = "";
    public string Country { get; set; } = "India";
    public string Landmark { get; set; } = "";
}
/// <summary>
/// An address in the shopper's reusable address book. Kept separate from <see cref="ShippingAddress"/>
/// so editing or deleting a saved address never rewrites the address a past order was shipped to.
/// </summary>
public class SavedAddress
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Line1 { get; set; } = "";
    public string Line2 { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string PostalCode { get; set; } = "";
    public string Country { get; set; } = "India";
    public string Landmark { get; set; } = "";
    /// <summary>Exactly one address per shopper carries this flag; it is preselected at checkout.</summary>
    public bool IsDefault { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class OrderItem { public int Id { get; set; } public int OrderId { get; set; } public int ProductId { get; set; } public string ProductName { get; set; } = ""; public decimal UnitPrice { get; set; } public int Quantity { get; set; } }
public class Payment
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public decimal Amount { get; set; }
    public string Status { get; set; } = "";
    public string TransactionId { get; set; } = "";
    public string Method { get; set; } = "Card";
    public string CardBrand { get; set; } = "";
    public string CardLast4 { get; set; } = "";
    public string FailureReason { get; set; } = "";
    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Which gateway handled this payment: "razorpay" for live processing, "simulated" for the test gateway.</summary>
    public string Provider { get; set; } = "simulated";
    /// <summary>Gateway order handle (Razorpay order_...), used to reconcile against the provider dashboard.</summary>
    public string ProviderOrderId { get; set; } = "";
    /// <summary>Gateway payment handle (Razorpay pay_...); the reference to quote in a refund or dispute.</summary>
    public string ProviderPaymentId { get; set; } = "";
    public string Currency { get; set; } = "INR";
    public decimal RefundedAmount { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class AuditActivity { public int Id { get; set; } public int? UserId { get; set; } public string Action { get; set; } = ""; public string Details { get; set; } = ""; public DateTime CreatedAt { get; set; } = DateTime.UtcNow; }
public class PasswordResetToken
{
    public int Id { get; set; }
    public int UserId { get; set; }
    /// <summary>SHA-256 of the raw token; the raw value is never stored.</summary>
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
