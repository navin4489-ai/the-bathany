# The Bathany — Deployment Guide

## 1. Live URL — Hostinger VPS

**Storefront and API: https://bathany.com** (also https://www.bathany.com).

The Hostinger KVM 2 VPS `srv2011722.hstgr.cloud` runs Ubuntu 24.04, Docker and Traefik.
The app container serves both Angular and ASP.NET Core; a private SQL Server 2022
**Express** container holds users, orders and product images in the named `sql-data`
volume. SQL port 1433 is not published. Traefik terminates HTTPS on ports 80/443;
the app's port 8080 is published only to VPS loopback. Root `@` DNS points to
`2.24.161.23` and `www` is a CNAME to the root domain. Both serve valid HTTPS.

| What | URL |
| --- | --- |
| Storefront | https://bathany.com |
| Shop | https://bathany.com/shop |
| Wishlist | https://bathany.com/wishlist |
| Admin console | https://bathany.com/admin |
| API products | https://bathany.com/api/catalog/products |
| Health probe | https://bathany.com/health |

VPS panel: <https://hpanel.hostinger.com/vps/2011722/overview>. Source:
[navin4489-ai/the-bathany](https://github.com/navin4489-ai/the-bathany).
The running server has a clone at `/opt/the-bathany`; this deployment is **manual**,
not auto-deployed when code is pushed to GitHub. The Hostinger-specific Compose file
and scripts are [deploy.hostinger.yaml](../deploy.hostinger.yaml) and [deploy/](../deploy/).
They were copied from this workspace onto the VPS and have **not yet been pushed
to GitHub**; preserve them when updating the VPS clone.

### Access and secrets

The VPS has a dedicated SSH public key named `the-bathany-deploy`; its private key
is stored on the deployment workstation, **not in this repository**. SSH as `root`
to the VPS hostname with that key. The SQL passwords and JWT signing key are stored
only in `/opt/the-bathany/.env` (mode 600). The seeded admin password was **rotated
before DNS cutover** and the generated replacement is stored only in
`/root/the-bathany-admin-password` (mode 600); read it from a trusted terminal and
move it to a password manager. Do not put it in a document or chat. The existing
`navin4489@gmail.com` account is now Admin; the original seeded account has been
demoted to Customer. Do not rely on the seeded account for admin access.

Hostinger had also installed an unused Docker Registry listening publicly without
authentication on port 32768. It was stopped (not deleted) with the owner's approval;
do not restart it with a public port unless authentication and network access controls
are configured.

### Maintenance and backups

Run `docker compose --env-file .env -f deploy.hostinger.yaml ps` from
`/opt/the-bathany` to inspect the stack. After updating the source checkout, run
`docker compose --env-file .env -f deploy.hostinger.yaml up -d --build app`.
The first install used [hostinger-bootstrap.sh](../deploy/hostinger-bootstrap.sh)
to create the SQL schema, seed four products, create a limited SQL login and start
the app; do **not** rerun the seed on existing business data.

A daily 02:15 UTC SQL backup uses [hostinger-backup.sh](../deploy/hostinger-backup.sh)
and [hostinger-backup.cron](../deploy/hostinger-backup.cron). It runs `BACKUP DATABASE`
with checksum and `RESTORE VERIFYONLY`, stores seven days of `.bak` files in
`/opt/the-bathany-backups` (root-only), and has been tested. Hostinger also shows
weekly VPS backups. **Daily `.bak` files are on the same VPS: copy them to an
independent secure location for disaster recovery and test an actual restore.**
SQL Server Express has a **10 GB limit per database**; monitor growth of stored images.

### Previous free test deployment — Render

<https://the-bathany.onrender.com> remains a **separate test environment** with
InMemory data, which resets on restart. Its dashboard is
<https://dashboard.render.com/web/srv-daajsg1srm7s73f5imd0>. Do not use it to
verify Hostinger data or production orders. The earlier Cloudflare Quick Tunnel
was temporary and is no longer used.

## 2. Test credentials

> The credentials below are **only for the older disposable Render environment**,
> **not for bathany.com**. The VPS uses a random JWT key and a rotated admin password.

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@eshopper.local` | `AdminPassword123!` |
| Customer (test) | `livetest@test.com` | `LiveTest123!` |

You can register a fresh customer from **Sign up** on either site; accounts are separate.

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

## 5. Historical Cloudflare tunnel instructions (retired)

These instructions describe the older local test tunnel, **not** the Hostinger
deployment in §1. Run from the repository root only if reproducing that old setup.

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

## 6. Known limitations of the retired tunnel

1. **Ephemeral URL.** The tunnel address changes on every restart. Re-run step 4 and reshare.
2. **Data resets on restart.** The API runs with `Database:Provider = InMemory` in
   Development, so products, users, orders and uploaded images are recreated from seed data
   each time the API starts. Registered test accounts and placed orders will disappear.
3. **The host machine must stay on.** The tunnel proxies to a local process; if the machine
   sleeps or the API stops, the URL goes dark.
4. **CORS is `AllowAnyOrigin`.** Harmless while single-origin, but must be restricted to the
   real domain before production.

## 7. Previous hosting checklist (historical)

> For the complete production configuration and payment gateway requirements, see
> [PRODUCTION-REQUIREMENTS.md](./PRODUCTION-REQUIREMENTS.md).

The single-origin setup above deploys as one container, which suits any free app host
(Render, Fly.io, Azure App Service free tier). Checklist before going live:

1. **Persist the database.** Switch `Database:Provider` off `InMemory` and point
   `ConnectionStrings:DefaultConnection` at a managed instance. Apply
   `apps/database/schema.sql` then `apps/database/seed.sql`.
   The SQL Server path was subsequently validated on the Hostinger VPS in §11.
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

## 8. Verified on the former Cloudflare test URL

- All storefront routes and deep links return `200` (`/`, `/shop`, `/rituals`,
  `/ingredients`, `/care`, `/admin`).
- Every image renders over HTTPS with no failed network requests.
- Customer registration and login succeed.
- A full card checkout completed: order status `Paid`, total ₹1,699, with the shipping
  address stored against the order.
- Admin sign-in returns the `Admin` role and the console loads.
- `/health` returns `200`.

## 9. Earlier responsive / mobile verification

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

## 11. Hostinger verification (27 Sep 2026)

- `https://bathany.com` and `https://www.bathany.com` serve the storefront over
  verified HTTPS; HTTP redirects to HTTPS.
- `/health`, `/api/catalog/products`, all four `/api/catalog/images/{id}` endpoints
  return 200. Swagger's production spec returns 404.
- SQL Server 2022 Express is healthy and **private**; the persistent `sql-data` volume
  survives restarting both database and app containers.
- Registered a test customer, logged in and completed a SQL-backed dummy card checkout:
  order #1 `Paid`, ₹1,299, with shipping address. After restarting both containers,
  the admin API still listed the order, 4 products and 2 users.
- The published default admin password returns 401; the replacement works and is
  saved only on the VPS for handoff.
- A checksum-verified SQL backup was created successfully and daily backups scheduled.

**This is a test checkout, not a real merchant launch.** The gateway is simulated;
password-reset email, rate limiting, restrictive CORS, a tested offsite restore and
real payment integration are still outstanding. Do not accept real orders or card
details until those requirements are completed.

## 12. Installable mobile web app

The Angular production build includes an Angular service worker, web manifest and
branded icons for a standalone progressive web app. From the storefront footer:

- **Android:** Open **Install on Android** in Chrome on the phone and tap the
  install button, or use Chrome's menu → **Install app / Add to Home screen**.
- **iPhone / iPad:** Open **Install on iPhone** in Safari and use Share →
  **Add to Home Screen** → Add. iOS does not support a programmatic install prompt.

The live install guides are `/install/android` and `/install/ios`. Neither is an
APK, IPA or app-store listing. The worker caches the app shell and static assets;
API responses, login and checkout are network-only. Test against the live HTTPS
domain; the Angular development server does not register the worker.

Verified on the live VPS: manifest (correct MIME type), worker, icon variants,
Apple touch icon and both install routes all return 200 over trusted HTTPS.
In a fresh Edge browser profile the worker activated and controlled the page,
and the browser's native install event exposed the Install button. The guide
also rendered correctly at 390px without horizontal overflow. Actual home-screen
installation on physical Android and iOS devices still needs manual confirmation.
