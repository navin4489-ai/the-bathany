# The Bathany — Production Requirements

**Version 1.0 · 31 August 2026**

Two sections only:

1. [Server configuration](#1-server-configuration)
2. [Payment gateway requirements for integration](#2-payment-gateway-requirements-for-integration)

---

## 1. Server configuration

### 1.1 Server specification

| Item | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB SSD | 40 GB SSD |
| OS | Windows Server 2019+ or Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Runtime | .NET 9 ASP.NET Core Runtime | .NET 9 Hosting Bundle (Windows/IIS) |
| Database | SQL Server 2019+ / Azure SQL | Azure SQL or managed SQL Server |
| Web server | nginx or IIS as a TLS reverse proxy | nginx + Let's Encrypt |

The API also serves the Angular SPA from `wwwroot`, so **one server, one origin** — no
separate frontend host is needed.

### 1.2 Network and ports

| Port | Purpose | Exposure |
|---|---|---|
| 443 | HTTPS public traffic | Public |
| 80 | HTTP → HTTPS redirect only | Public |
| 8080 | Application (Kestrel) | **Localhost / internal only** |
| 1433 | SQL Server | **Private network only — never public** |

Outbound HTTPS (443) must be allowed so the server can reach the payment gateway and
email provider.

### 1.3 Environment variables

Nested keys use a **double underscore**. Set all of these on the production host.

| Env var | Required | Production value |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | **Yes** | `Production` |
| `ASPNETCORE_URLS` | **Yes** | `http://+:8080` |
| `ConnectionStrings__DefaultConnection` | **Yes** | Production SQL connection string with `Encrypt=True;TrustServerCertificate=False` |
| `Database__Provider` | **Yes** | **Leave unset** — any value other than `InMemory` selects SQL Server |
| `Jwt__SigningKey` | **Yes** | 32+ character random secret from your vault |
| `Jwt__Issuer` | Yes | e.g. `api.thebathany.com` |
| `Jwt__Audience` | Yes | e.g. `www.thebathany.com` |
| `Auth__ExposeResetToken` | **Yes** | `false` |
| `AllowedHosts` | Recommended | Your exact domain(s), not `*` |
| `Logging__LogLevel__Default` | Recommended | `Warning` |

Generate the signing key:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
```

Store secrets in a vault (Azure Key Vault, AWS Secrets Manager). Never in source control
or a container image.

### 1.4 Critical settings that must change from development

| Setting | Development | Production | Consequence if missed |
|---|---|---|---|
| `Database__Provider` | `InMemory` | unset (SQL Server) | **All users, orders and payments are wiped on every restart** |
| `Auth__ExposeResetToken` | `true` | `false` | `forgot-password` returns the raw reset token in the response — **anyone knowing an email can take over that account** |
| Admin password | `AdminPassword123!` | Changed | Default credentials are published in this repository |
| `Jwt__SigningKey` | placeholder string | Unique random secret | Anyone can forge admin tokens |
| CORS | `AllowAnyOrigin` | Restricted to your domain | Unnecessary cross-origin access |
| TLS | Tunnel-terminated | Enforced, with HSTS | JWTs and card data sent in clear text |

> The app fails to start if `Jwt__SigningKey` is missing or under 32 characters — that
> guard is already in place.

### 1.5 Database setup

1. Provision SQL Server 2019+ or Azure SQL.
2. Run [`apps/database/schema.sql`](../apps/database/schema.sql).
3. Run [`apps/database/seed.sql`](../apps/database/seed.sql).
4. Create a dedicated SQL login with `db_datareader`, `db_datawriter` and `EXECUTE`
   only — **not** `db_owner`.
5. Enable automated backups with point-in-time restore, and rehearse a restore.

> **Updated 27 September 2026.** The earlier LocalDB problem on the development
> workstation did not reproduce on the Hostinger VPS. SQL Server 2022 Express was
> validated end to end there (register → login → checkout → admin), including
> persistence across container restarts. The hand-written SQL schema still needs
> migrations for future upgrades. SQL Server Express limits a database to 10 GB.

### 1.6 Build and deploy

```powershell
# 1. Build the Angular SPA
cd apps\web
node .\node_modules\@angular\cli\bin\ng.js build --configuration production

# 2. Publish the API
cd ..\api\Eshopper.Api
dotnet publish -c Release -o .\publish

# 3. Copy the SPA into wwwroot (keep the uploads folder)
Copy-Item ..\..\web\dist\eshopper-web\browser\* .\publish\wwwroot -Recurse -Force
```

Health probes already exist: `GET /health` and `GET /ready`.

### 1.7 Still missing — required before launch

- **SMTP / transactional email.** Not implemented. Once `Auth__ExposeResetToken` is
  `false`, **password reset has no delivery mechanism and will not work.** Add SendGrid,
  Amazon SES or Postmark with a verified sender domain (SPF + DKIM).
- **Rate limiting** on `/api/auth/login`, `/register` and `/forgot-password`.
- **Security headers**: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- **EF Core migrations** to replace the hand-written schema script.
- **Offsite backups and a tested full restore.** The Hostinger VPS now hosts the
  app and SQL Server with daily verified backups stored locally and weekly VPS
  backups, but same-server `.bak` files do not protect against loss of that server.

---

## 2. Payment gateway requirements for integration

### 2.1 Current state

The app uses `DummyPaymentGateway` — a deterministic simulator.

> **It never contacts a real processor and never moves money.** It validates Luhn,
> expiry, CVV and card length, then returns a fixed outcome based on the card number.

Supported methods (`GET /api/payments/methods`): `card`, `wallet`, `cod`.

### 2.2 Commercial prerequisites

Obtained by the business owner. These take the longest — **start them first.**

| Requirement | Notes |
|---|---|
| Registered business entity | Pvt Ltd, LLP or registered proprietorship |
| Business PAN | |
| GSTIN | Required by most Indian gateways |
| Current bank account | In the business name, for settlements |
| Cancelled cheque | Settlement account proof |
| Director/proprietor KYC | PAN + Aadhaar |
| Business address proof | Utility bill or rental agreement |
| Published policy pages | Terms, Privacy, Refund/Cancellation, Shipping, Contact Us — **gateways verify these exist before approving the account.** The storefront does not have them yet. |
| Merchant account approval | Underwriting: several days to a few weeks |

### 2.3 Compliance

**PCI DSS.** The current checkout posts raw card data (`number`, `holderName`, `expiry`,
`cvv`) to the API. This is safe only because no real card is involved.

> **Accepting a real card through the existing flow puts the entire application and
> database into PCI DSS scope, requiring a full Level 1 audit.**

Use the provider's **hosted checkout page or drop-in iframe** (Razorpay Checkout, Stripe
Elements, PayU Bolt). The card is entered inside the provider's iframe, your server
receives only a token, and you qualify for the far simpler **SAQ A**. The `CardDetails`
record and card fields must be removed from the API.

**RBI rules for Indian merchants:**
- Card numbers may not be stored — saved cards require network tokenisation.
- Domestic card payments need Additional Factor of Authentication (3-D Secure OTP).
- e-Mandate with pre-debit notification if you add subscriptions.

### 2.4 Recommended providers

| Provider | Notes |
|---|---|
| **Razorpay** | Best fit for India — UPI, cards, netbanking, wallets, EMI |
| **PayU India** | Established, wide bank coverage |
| **Cashfree** | Competitive pricing, fast onboarding |
| **CCAvenue** | Broadest payment-method coverage |
| **Stripe** | Great DX, but weaker India coverage |

### 2.5 Integration work required

The checkout depends on the `IPaymentGateway` **interface**, so the provider swap is one
line in `Program.cs`:

```csharp
// Program.cs line 25 — replace:
builder.Services.AddSingleton<IPaymentGateway, DummyPaymentGateway>();
// with:
builder.Services.AddScoped<IPaymentGateway, RazorpayPaymentGateway>();
```

Required changes beyond the adapter:

1. **Make `Charge` async.** It is currently synchronous; a real gateway call is network
   I/O. Change to `Task<PaymentResult> ChargeAsync(...)` and update `CheckoutService`.
2. **Switch to order-then-verify.** Real gateways create a payment order, redirect or
   open a widget, then confirm asynchronously — not a single synchronous charge.
3. **Implement webhooks.** `POST /api/payments/webhook`, verifying the provider's HMAC
   signature. **The webhook — not the browser redirect — is the authoritative source of
   payment status**, because a customer can close the browser before returning.
4. **Handle 3-D Secure / OTP redirects** and the customer's return journey.
5. **Remove raw card handling** — delete `CardDetails` and the card fields from
   `CheckoutRequest`.
6. **Add refunds.** The admin console has a `Refunded` status but no refund API call.
7. **Map the existing `IdempotencyKey`** to the provider's idempotency mechanism so a
   retry cannot double-charge.
8. **Daily reconciliation** against gateway settlement reports.

### 2.6 Gateway configuration

| Env var | Notes |
|---|---|
| `Payments__KeyId` | Public merchant/key ID — safe in the SPA |
| `Payments__KeySecret` | **Secret** — server-side only, from the vault |
| `Payments__WebhookSecret` | **Secret** — verifies webhook authenticity |
| `Payments__Mode` | `test` or `live` |
| `Payments__Currency` | `INR` |

**Never log or store:** full card number (PAN), CVV (not even encrypted), or the key and
webhook secrets. Storing brand + last four digits, as the `Payment` entity does today, is
permitted and should be kept.

### 2.7 Go-live sequence

1. Merchant account approved in **test mode**
2. Build the `IPaymentGateway` adapter against the sandbox
3. Convert to the async, order-then-verify flow
4. Implement and verify webhook signature validation
5. Test success, decline, timeout, 3-D Secure challenge and abandonment
6. Test full and partial refunds
7. Reconcile orders against the sandbox settlement report
8. Complete the provider go-live checklist and PCI SAQ A
9. Switch to live keys; keep sandbox keys in staging
10. Process one small real transaction and refund it
11. Monitor the first day of live traffic closely

---

**Related:** [BRD.md](./BRD.md) · [DEPLOYMENT.md](./DEPLOYMENT.md)
