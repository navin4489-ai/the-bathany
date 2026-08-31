# The Bathany — Deployment Guide

## 1. Live URL (permanent — Render)

The application is deployed on **Render's free tier** from the GitHub repository
[navin4489-ai/the-bathany](https://github.com/navin4489-ai/the-bathany). A single Docker
container builds the Angular SPA and the .NET 9 API and serves both from **one origin**,
so there is only one URL to share.

**Live site: https://the-bathany.onrender.com**

| What | URL |
| --- | --- |
| Storefront (home) | https://the-bathany.onrender.com |
| Shop / collection | https://the-bathany.onrender.com/shop |
| Wishlist | https://the-bathany.onrender.com/wishlist |
| Our Rituals | https://the-bathany.onrender.com/rituals |
| Ingredients | https://the-bathany.onrender.com/ingredients |
| Care | https://the-bathany.onrender.com/care |
| My orders | https://the-bathany.onrender.com/orders |
| Admin console | https://the-bathany.onrender.com/admin |
| API (products) | https://the-bathany.onrender.com/api/catalog/products |
| Health probe | https://the-bathany.onrender.com/health |

Management dashboard: <https://dashboard.render.com/web/srv-daajsg1srm7s73f5imd0>
(service `the-bathany`, blueprint `the-bathany`, workspace "Navin's workspace").

Deployment is **automatic**: pushing to `main` on GitHub triggers a rebuild and redeploy.

### Free-tier characteristics

1. **Cold starts.** The instance spins down after ~15 minutes of inactivity. The next
   request can take **50 seconds or more** while it wakes. This is normal, not a fault.
2. **Data is not persistent.** The service runs with `Database__Provider=InMemory`, so
   **all users, orders and uploaded images are lost on every restart**, including after a
   spin-down. Attach a real database to fix this — see
   [PRODUCTION-REQUIREMENTS.md](./PRODUCTION-REQUIREMENTS.md) §1.5.
3. **Shared resources.** 512 MB RAM and shared CPU, so responses are slower than local.

### Previous test URL (retired)

An earlier deployment used a Cloudflare Quick Tunnel. That approach issued a **new random
URL on every restart** and required a local process to stay running, so it has been
replaced by the Render deployment above.

> **Why not Cloudflare?** Cloudflare Pages and Workers run static assets and JavaScript on
> V8 — they **cannot execute an ASP.NET Core process or SQL Server**. Cloudflare Containers
> can, but the dashboard requires the paid **Workers Paid** plan, and a Named Tunnel needs a
> registered domain. Render was chosen because it runs the .NET API and the SPA together at
> no cost.

## 2. Test credentials

> These are throwaway test accounts on a disposable environment. **Both the seeded admin
> password and the JWT signing key must be replaced before any real production use.**

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@eshopper.local` | `AdminPassword123!` |
| Customer (test) | `livetest@test.com` | `LiveTest123!` |

You can also register a fresh customer from **Sign up** on the live site.

## 3. Dummy payment gateway test cards

Checkout is wired to a simulated gateway — **no real money moves and no real card data is
accepted.** Use any future expiry (e.g. `12/2030`) and any 3-digit CVV.

| Card number | Result |
| --- | --- |
| `4242 4242 4242 4242` | Approved (Visa) |
| `5555 5555 5555 4444` | Approved (Mastercard) |
| `4000 0000 0000 0002` | Declined — card declined by issuer |
| `4000 0000 0000 9995` | Declined — insufficient funds |
| `4000 0000 0000 0119` | Gateway processing error |

Declined and errored orders are still recorded (status `PaymentFailed`) for audit, and any
stock they reserved is released automatically.

## 4. Architecture as deployed

- The Angular app is built to a static bundle and copied into the API's `wwwroot`.
- ASP.NET Core serves those static files, and `MapFallback` returns `index.html` for any
  non-`/api` path so client-side routing works on deep links and refreshes.
- Because the SPA and API share one origin, `API_ORIGIN` in `main.ts` resolves to an empty
  string (relative URLs). It only falls back to `http://localhost:5000` on the Angular dev
  server (port 4200), so local development is unaffected.
- Product images are stored as rows in the database and served from
  `GET /api/catalog/images/{id}`.

## 5. Reproducing the deployment

Run from the repository root.

```powershell
# 1. Build the Angular bundle
cd apps\web
node .\node_modules\@angular\cli\bin\ng.js build

# 2. Publish it into the API's wwwroot (keep the uploads folder)
$dist = "..\..\apps\web\dist\eshopper-web\browser"
$wwwroot = "..\..\apps\api\Eshopper.Api\wwwroot"
Get-ChildItem $wwwroot -Exclude 'uploads' | Remove-Item -Recurse -Force
Copy-Item "$dist\*" $wwwroot -Recurse -Force

# 3. Start the API (serves both the SPA and the API)
cd ..\api\Eshopper.Api
dotnet run --urls http://localhost:5000

# 4. In a second terminal, publish it to a free public HTTPS URL
cd apps\tools
.\cloudflared.exe tunnel --url http://localhost:5000 --logfile tunnel.log
```

The public URL is printed in the console and written to `apps/tools/tunnel.log`; grab it with:

```powershell
Select-String -Path apps\tools\tunnel.log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
  ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1
```

`cloudflared.exe` is downloaded once from the official Cloudflare GitHub release and lives in
`apps/tools/` (it is a large binary and should not be committed).

## 6. Known limitations of this test deployment

1. **Ephemeral URL.** The tunnel address changes on every restart. Re-run step 4 and reshare.
2. **Data resets on restart.** The API runs with `Database:Provider = InMemory` in
   Development, so products, users, orders and uploaded images are recreated from seed data
   each time the API starts. Registered test accounts and placed orders will disappear.
3. **The host machine must stay on.** The tunnel proxies to a local process; if the machine
   sleeps or the API stops, the URL goes dark.
4. **CORS is `AllowAnyOrigin`.** Harmless while single-origin, but must be restricted to the
   real domain before production.

## 7. Moving to permanent free hosting

> For the complete production configuration and payment gateway requirements, see
> [PRODUCTION-REQUIREMENTS.md](./PRODUCTION-REQUIREMENTS.md).

The single-origin setup above deploys as one container, which suits any free app host
(Render, Fly.io, Azure App Service free tier). Checklist before going live:

1. **Persist the database.** Switch `Database:Provider` off `InMemory` and point
   `ConnectionStrings:DefaultConnection` at a managed instance. Apply
   `apps/database/schema.sql` then `apps/database/seed.sql`.
   *Note: the SQL Server path is configured but has not been validated end to end through
   EF Core in this environment — budget time to verify it.*
2. **Replace `Jwt:SigningKey`** with a fresh secret of at least 32 characters, supplied as an
   environment variable, never committed.
3. **Change the seeded admin password** immediately after the first sign-in.
4. **Restrict CORS** to the production domain.
5. **Bind to the host's port**, e.g. `--urls http://0.0.0.0:$PORT`.
6. Keep `/health` and `/ready` as the platform's health-check endpoints.

### Environment variables

| Variable | Purpose | Example |
| --- | --- | --- |
| `ASPNETCORE_ENVIRONMENT` | Disables Swagger and dev defaults | `Production` |
| `ASPNETCORE_URLS` | Bind address and port | `http://0.0.0.0:8080` |
| `Database__Provider` | Anything other than `InMemory` uses SQL Server | `SqlServer` |
| `ConnectionStrings__DefaultConnection` | Database connection string | `Server=...;Database=Eshopper;...` |
| `Jwt__SigningKey` | Token signing secret (32+ chars) | *(generated secret)* |
| `Jwt__Issuer` / `Jwt__Audience` | Token validation values | `bathany-api` / `bathany-web` |

## 8. Verified on the live URL

- All storefront routes and deep links return `200` (`/`, `/shop`, `/rituals`,
  `/ingredients`, `/care`, `/admin`).
- Every image renders over HTTPS with no failed network requests.
- Customer registration and login succeed.
- A full card checkout completed: order status `Paid`, total ₹1,699, with the shipping
  address stored against the order.
- Admin sign-in returns the `Admin` role and the console loads.
- `/health` returns `200`.

## 9. Responsive / mobile verification

Checked at 320, 360, 390, 414, 768, 1024 and 1440px wide:

- No page scrolls horizontally at any of those widths.
- The hamburger menu appears at and below 900px and the full horizontal nav returns above it;
  menu links are 49px tall and the menu closes when a link is tapped.
- The product grid runs 4 columns on desktop, 3 on tablet and 1 on phones.
- Wide admin tables (the 8-column Orders view) scroll inside their own container while the
  surrounding page stays fixed.
- All checkout inputs render at 16px, so iOS Safari does not zoom in when a field is focused.
- A complete purchase was made at 390px wide: order #5, `Approved`, ₹1,299, with the
  confirmation modal fitting inside the viewport.

## 10. Live verification on Render (31 Aug 2026)

Every check below was run against **https://the-bathany.onrender.com** over the public
internet after the first successful deploy (commit `e43d4a7`, build 1m32s).

| Check | Result |
| --- | --- |
| `/health` | 200 |
| SPA routes `/`, `/shop`, `/wishlist`, `/rituals`, `/admin` | all 200 |
| `GET /api/catalog/products` | 4 products, INR pricing |
| DB-backed images `/api/catalog/images/1..4` | all 200, `image/jpeg`, 81–113 KB |
| Static assets `/assets/brand/*` | all 200 (9/9 requests in browser network log) |
| Register + login | 200, `accessToken` issued |
| **Card checkout** (`4242…4242`, qty 2) | **order #1 `Paid` ₹3,398, Visa \*\*\*\*4242** |
| Shipping address stored | Mumbai, Maharashtra 400020 |
| **Declined card** (`4000…0002`) | order #2 `PaymentFailed`, "Card declined by issuer." |
| Admin login | role `Admin` |
| `GET /api/admin/config` | currency `INR ₹` |
| `GET /api/admin/orders` | admin sees the order |
| **Swagger disabled in Production** | `/swagger/v1/swagger.json` → **404** |
| **Reset-token leak check** | `forgot-password` returns only `message` — **no token** |

Both production hardening flags were confirmed **in the live environment**, not just in
configuration: Swagger is off and `Auth__ExposeResetToken=false` is effective.

> **Note on intermittent image warnings.** During testing, browser snapshots occasionally
> reported a product image as not yet decoded. Capturing the actual network responses showed
> **HTTP 200 for every asset request**; the readings were the page snapshot racing image
> decode on a slow free-tier connection, not a missing file.
