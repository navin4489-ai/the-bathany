namespace Eshopper.Api.Services;

public static class AdminActivityNotification
{
    public static string Body(IReadOnlyList<string> actions)
    {
        if (actions.Count == 0) throw new ArgumentException("A notification requires at least one activity.", nameof(actions));
        var groups = actions.GroupBy(Label).ToList();
        var summary = string.Join("; ", groups.Take(4).Select(g => $"{g.Key} ({g.Count()})"));
        if (groups.Count > 4) summary += $"; {groups.Skip(4).Sum(g => g.Count())} other activities";
        return $"{summary}. Open Admin to review.";
    }

    private static string Label(string action) => action switch
    {
        "PageView" => "Page visits",
        "ProductView" => "Product views",
        "Search" => "Searches",
        "Register" => "Signups",
        "Login" => "Logins",
        "LoginFailed" => "Failed logins",
        "Logout" => "Logouts",
        "CartAdd" => "Added to cart",
        "CartRemove" => "Removed from cart",
        "CartQuantityChanged" => "Cart quantity changes",
        "WishlistAdd" or "WishlistRemove" => "Wishlist changes",
        "CheckoutStarted" => "Checkout started",
        "Checkout" => "Orders placed",
        "PaymentCancelled" => "Payments cancelled",
        "PaymentFailed" => "Payment failures reported",
        "OfferClick" => "Offer views",
        "AddressAdded" or "AddressUpdated" or "AddressDeleted" => "Address changes",
        "OrderStatusChanged" => "Order status updates",
        "ProductCreated" or "ProductUpdated" or "ProductDeleted" or "ProductDeactivated" => "Product updates",
        "OfferCreated" or "OfferUpdated" or "OfferDeleted" => "Offer updates",
        "PasswordResetRequested" or "PasswordReset" or "PasswordChanged" or "AdminPasswordReset" => "Password activity",
        "UserRoleChanged" => "Account role updates",
        "PaymentOptionChanged" => "Payment setting updates",
        _ => "Other store activity"
    };
}
