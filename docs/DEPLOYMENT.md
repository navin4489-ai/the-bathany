# The Bathany — Deployment Guide

## 1. Live test URL

The application is published on a free Cloudflare Quick Tunnel. Both the Angular storefront
and the .NET API are served from a **single origin**, so there is only one URL to share.

| What | URL |
| --- | --- |
| Storefront (home) | https://imperial-listen-explanation-parts.trycloudflare.com |
| Shop / collection | https://imperial-listen-explanation-parts.trycloudflare.com/shop |
| Our Rituals | https://imperial-listen-explanation-parts.trycloudflare.com/rituals |
| Ingredients | https://imperial-listen-explanation-parts.trycloudflare.com/ingredients |
| Care | https://imperial-listen-explanation-parts.trycloudflare.com/care |
| My orders | https://imperial-listen-explanation-parts.trycloudflare.com/orders |
| Admin console | https://imperial-listen-explanation-parts.trycloudflare.com/admin |
| API root | https://imperial-listen-explanation-parts.trycloudflare.com/api/catalog/products |
| Health probe | https://imperial-listen-explanation-parts.trycloudflare.com/health |
| Swagger (dev only) | https://imperial-listen-explanation-parts.trycloudflare.com/swagger |

> **This URL is temporary.** A Quick Tunnel URL lives only as long as the `cloudflared`
> process and the local API keep running, and a **new random URL is issued every restart**.
> It is intended for testing and demos, not for production. See §6 for permanent hosting.

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
