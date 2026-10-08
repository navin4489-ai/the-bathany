# The Bathany application foundation

The original HTML/CSS/JS template remains untouched at the repository root. New production-oriented application code lives under `apps`.

## Run the API

Requires the .NET 9 SDK. Development uses an in-memory seeded database by default; production uses SQL Server.

```powershell
cd apps/api/Eshopper.Api
dotnet restore
dotnet run
```

Swagger is available at http://localhost:5000/swagger. Configure `ConnectionStrings:DefaultConnection` and `Jwt` values using `appsettings.Development.json` or environment variables. Authentication is intentionally JWT-ready; add token issuance and issuer validation before production deployment.

## Database

For production SQL Server, run `apps/database/schema.sql`, then `apps/database/seed.sql`. Development uses seed data from `ShopDbContext`; set `Database:Provider` to `SqlServer` when validating a SQL environment.

## Run Angular

```powershell
cd apps/web
npm install
npm start
```

The shop automatically falls back to deterministic local catalog data when the API is unavailable. Cart state is kept in local storage. Register via `POST /api/auth/register`, then login. Checkout requires a bearer token and a unique idempotency key; retries with that key return the original order.

## Razorpay Standard Web Checkout

The Angular cart loads `https://checkout.razorpay.com/v1/checkout.js` on demand. The .NET API uses its existing `HttpClient` integration; no Node.js payment SDK is needed.

Create an untracked root `.env` containing `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, then launch locally:

```powershell
.\apps\api\run-local.ps1
```

In another terminal run Angular using the commands above. Sign in, add a product, supply a shipping address, and select **Pay Online (Razorpay)**. Test keys open the test-mode modal; use Razorpay's documented test payment details, not real card details. Successful callbacks go to verification and then checkout, which persists the order and payment history. Closing the modal or a failed payment keeps the cart intact.

- `POST /api/create-order` (also `/api/payments/razorpay/order`): authenticated body `{ "items": [{ "productId": 1, "quantity": 1 }] }`. Prices and stock come from SQL, not browser-supplied amounts. Returns `order_id`, `amount` in paise, `currency`, and public `keyId`. Minimum is 100 paise.
- `POST /api/verify-payment` (also `/api/payments/razorpay/verify`): authenticated body containing `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`. Missing fields or invalid signatures return 400. It uses HMAC-SHA256 and a fixed-time comparison, then confirms ownership, amount, currency, and payment status with Razorpay. It does not create a shop order itself.
- `POST /api/checkout`: independently re-verifies the payment against the cart total before persisting an order. Only captured payments are marked paid; authorized payments remain awaiting payment.

Both environment names above and .NET's `Razorpay__KeyId` / `Razorpay__KeySecret` configuration are supported. Hostinger Compose already maps the root `.env` values into the backend. `.env` is excluded from Git and Docker build contexts; the secret is never sent to Angular. Changing Compose environment values requires recreating the app container, not merely restarting it.

Provider authentication failures return 401 and other provider failures return 500 on the create/verify endpoints. No order is marked paid after failed verification. Rotate any API secret shared in chat before live use, complete Razorpay KYC, and configure live keys and capture settings in the dashboard. Webhook reconciliation for interrupted browser sessions remains a separate production requirement.

### Admin payment availability

Admin -> Payments -> Payment options offers **Enable Razorpay / Disable Razorpay**. The setting is stored in SQL Server (enabled by default), takes effect without a restart, and each change is recorded in the admin activity log. Apply `apps/database/migrations/004-payment-options.sql` before deploying this version to an existing database; new databases include it in the schema.

Disabling hides available checkout methods and blocks new Razorpay orders on the server, including requests from a cart page opened before the setting changed. It does not activate card/wallet/COD fallbacks. Payment verification and final checkout for already-started Razorpay sessions remain available so a paid shopper is not stranded. Re-enabling restores new sessions; API credentials must still be configured separately. The development in-memory database resets the setting when the API restarts; production SQL Server retains it.

### Scheduled promotional offers

Admin -> Offers manages image banners with title, description, enable/disable, and valid-from/valid-until dates. Upload an image (up to 4 MB) and save. Admin dates use the device's local timezone and are stored as UTC. Only enabled banners inside their validity window are returned by `/api/offers`, with the end time exclusive. Home and Shop show the banners and a **Shop now** link. These are promotional banners only: no coupons or automatic price reductions are applied.

Shop pages refresh banners every 30 seconds and on window focus, and remove expired banners automatically. Existing SQL deployments must apply `apps/database/migrations/007-offer-banners.sql` before this release. Offer images reuse the existing database-backed image store so they survive app restarts. Offer creation, updates, uploads, and deletion are recorded in the activity log.

### Installed-app login

Sign in from the installed Android/iOS PWA to create a renewable device session. Access tokens last 15 minutes; an HttpOnly refresh cookie renews them automatically, including after closing/reopening the app. Ordinary browser logins retain the existing two-hour lifetime. Refresh secrets are hashed in SQL, never stored in JavaScript, and logout or password changes revoke device sessions. Temporary network failures retain app credentials and show a connection warning rather than silently signing the user out.

PWAs cannot detect uninstall reliably. Removing site data clears local credentials; uninstall may retain browser data. Browsers can also evict storage or limit cookie lifetime, so indefinite login or automatic uninstall-triggered server revocation cannot be guaranteed. Apply `005-app-sessions.sql` to existing databases.

### Admin mobile push

Build Angular with `npx ng build --configuration production` and serve over HTTPS. Create stable VAPID credentials in the ignored root `.env`:

```powershell
.\apps\api\generate-vapid.ps1 -Subject mailto:donotreply@bathany.com
```

The helper preserves other settings and refuses to replace existing keys. Load `.env` with `run-local.ps1` locally; Hostinger Compose forwards `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. The private key stays on the server. Keep these keys backed up securely and stable across deployments; rotation requires device resubscription. Missing/invalid configuration disables push with an explicit server warning.

Apply `006-admin-push.sql`, restart/recreate the API container, then sign in as an administrator and choose **Enable notifications**. Permission is requested only on this click. On iOS/iPadOS, Web Push requires version 16.4+ and a Home Screen-installed PWA. Use **Refresh notifications** if service-worker registration is still starting, or reconnect to recover suspended delivery.

Audited store activity is batched into notifications with a count and an Admin link, without private activity details. Subscription cursors and pending batches survive restarts; failed deliveries retry with backoff and eventually suspend until reconnect. Logout removes this device's subscription; password changes remove all subscriptions for that account. Revoked installed sessions and accounts no longer holding the Admin role cannot receive new notifications.

Verify on a real permitted device: close the installed app, create a new login/cart/order activity from another browser, and check the notification opens Admin. OS permission settings, connectivity and push providers affect delivery; provider acceptance is not proof of device receipt. Already-delivered notifications cannot be recalled and delivery can duplicate after a server crash.

Existing production databases should apply migrations **004, 005, 006, 007** in order before deploying this release. New databases use the complete schema instead. Do not apply development seed data over production data.
