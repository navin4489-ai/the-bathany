# The Bathany Modern Commerce Platform

## 1. Document control

| Field | Value |
| --- | --- |
| Product | The Bathany |
| Version | 1.0 |
| Status | Baseline approved for implementation |
| Date | 2026-08-30 |
| Audience | Product, engineering, QA, operations |

## 2. Executive summary

The Bathany storefront began as a static Bootstrap shopping template. This initiative turns it into a maintainable, secure, production-oriented commerce platform with an Angular customer experience, an ASP.NET Core API, and a SQL relational data store. The first release supports browsing, search, cart, checkout, a deterministic dummy payment gateway for non-production testing, order tracking, authentication boundaries, and an administrator workspace.

The existing visual assets remain available during the transition. New application code is isolated from the original template so the redesign can be delivered incrementally without losing the current reference UI.

## 2a. Brand identity

The storefront trades as **The Bathany** — small-batch botanical bath rituals, handcrafted in India.

| Element | Value |
| --- | --- |
| Logo | `apps/web/src/assets/brand/logo.jpeg` — gold letterpress crest, shown in the header, footer, auth panels, order confirmation and admin console |
| Display type | Cormorant Garamond (headings, brand name) |
| Body type | Jost |
| Primary | `#c9a227` gold · Dark `#a07d16` |
| Surfaces | Cream `#faf6ef` · Blush `#f6e7e4` · Ink `#2b2620` |
| Voice | Warm, sensory, unhurried — "rituals" not "items", "the collection" not "featured products" |
| Product promise | All natural · Cruelty free · Sulfate free · Paraben free · Handcrafted in India |

Catalogue (four launch products, all priced in INR):

| # | Product | Category | Price |
| --- | --- | --- | --- |
| 1 | Potion No. 04 | Bath Rituals | ₹1,299 |
| 2 | Chai Spice Soul Whipped Soap | Whipped Soaps | ₹1,499 |
| 3 | Raspberry Swirl Bath Cloud | Bath Rituals | ₹1,699 |
| 4 | Whipped Soap Boba | Whipped Soaps | ₹899 |

Brand imagery lives in `apps/web/src/assets/brand/` and is published to `assets/` by the Angular build. The original template's `img/` folder is still served untouched at `/img` for reference.

## 3. Goals and success measures

### Goals

1. Enable a customer to discover products, create a cart, place a test-paid order, and view order status end to end.
2. Give authorized administrators control over products, inventory visibility, orders, users, and audit activity.
3. Establish clear API, database, security, observability, and deployment boundaries suitable for production hardening.
4. Make payment behavior testable without handling real card data.

### Success measures

- A seeded environment can complete browse → cart → checkout → dummy payment → confirmation.
- Inventory cannot become negative when concurrent orders are placed.
- Every privileged write creates an audit activity record.
- Customer and admin routes enforce authorization server-side.
- API, database, and frontend can be deployed independently using environment configuration.

## 4. Scope

### In scope for release 1

- Responsive Angular storefront: home/catalog, category and text search, product detail, cart, checkout, confirmation, account and order history.
- Customer identity model with registration/login-ready API boundaries, password hashing, refresh-token-ready design, and role claims.
- Products, categories, pricing, stock, images, active/archived state.
- Orders with immutable line-item snapshots, totals, shipping address, status history, and cancellation rules.
- Dummy payment provider with success, decline, and deterministic test-error scenarios; no real card storage.
- Angular admin workspace for product CRUD, stock/status updates, order status updates, user status/role review, and activity/audit search.
- SQL schema, indexes, foreign keys, seed data, health checks, structured error responses, CORS configuration, and environment examples.

### Out of scope for release 1

- Real payment processor settlement, refunds, chargebacks, tax calculation, shipping carrier integration, marketplace vendors, coupons, reviews, recommendations, and native mobile apps.
- Multi-region active/active deployment and advanced analytics.

## 5. Personas and permissions

| Persona | Needs | Permissions |
| --- | --- | --- |
| Guest | Browse and search | Read public catalog; may build a local cart |
| Customer | Purchase and track orders | Manage own profile/cart/orders; initiate checkout |
| Catalog manager | Maintain merchandise | Product/category/inventory writes |
| Operations admin | Fulfill commerce | Order status and customer support views |
| Super admin | Govern platform | User roles, audit activity, system configuration |

Authorization is deny-by-default. The API, not only the Angular router, is the source of truth for permissions.

## 6. Functional requirements

### Storefront

- **FR-01 Catalog:** List active products with pagination, category filter, search, sort, price, stock, and image metadata.
- **FR-02 Detail:** Show product description, price, availability, and quantity validation.
- **FR-03 Cart:** Add, update, and remove items; recalculate totals from server-side product prices during checkout.
- **FR-04 Checkout:** Capture validated contact and shipping information, show a final total, and prevent duplicate submissions with an idempotency key.
- **FR-05 Payment:** Submit a payment intent to the dummy provider; return approved/declined/error outcomes with a safe public reference.
- **FR-06 Orders:** Show confirmation, customer order history, detail, status timeline, and cancellation where policy allows.
- **FR-07 Identity:** Support registration/login-ready flows, sign-out, protected customer routes, and role-aware navigation.

### Administration

- **FR-08 Product management:** Create, edit, archive/activate, update stock, and manage category/image metadata.
- **FR-09 Order management:** Search/filter orders, inspect lines and payment state, and transition status using an allowed state machine.
- **FR-10 User management:** Search users, activate/deactivate accounts, review roles, and avoid exposing credential material.
- **FR-11 Activity:** Record actor, action, entity, timestamp, correlation ID, and safe before/after metadata for privileged activity.
- **FR-12 Dashboard:** Show order count, revenue summary, low-stock items, pending fulfillment, and recent activity.
- **FR-13 Configurable console:** The admin UI is server-driven. `GET /api/admin/config` returns the section list, order statuses, roles, categories and active currency, so sections and option lists can change without a frontend release. All admin data is presented in sortable tables — never raw JSON.
- **FR-14 Shipping address:** Every order must carry a delivery address captured at checkout (recipient name, 10-digit phone, address line 1, optional line 2 and landmark, city, state, 6-digit PIN, country). The address is validated on both the client and the server, stored 1:1 with the order, and surfaced on the confirmation modal, the customer's order history and the admin Orders table. Shoppers may opt to save the address locally for reuse on the next order.
- **FR-15 Database-backed product images:** Product images are stored as binary rows in the `ProductImages` table, not on the web server's disk, so images survive restarts and stay consistent across multiple instances. Admin uploads are validated by magic bytes (not extension), capped at 4 MB, restricted to JPG/PNG/GIF/WEBP, given a server-generated GUID filename, and recorded with the uploading admin. The stored content type is derived from the verified extension rather than the client-supplied header. Images are served publicly from `GET /api/catalog/images/{id}` with long-lived immutable cache headers, and products reference them by that relative URL. The four catalogue images ship as seed data and are loaded into the database on first start. Creating a product without an image is rejected, and the admin Save button is disabled until an in-progress upload finishes so its returned image URL can be saved with the product.
- **FR-16 Responsive, mobile-friendly UI:** The storefront and admin console must be fully usable on phones and tablets. Below 900px the main navigation collapses behind a hamburger menu that closes on selection; below 720px the product grid, cart rows, order cards, checkout form and footer stack into a single column; wide admin tables scroll horizontally inside their own container instead of breaking the page. Interactive controls have a minimum 44px touch target and form inputs use a 16px font so iOS does not zoom on focus. No page may scroll horizontally at any viewport from 320px upward.

- **FR-17 Wishlist:** Shoppers can save products for later from a heart control on every product card and from the product detail page. The control reflects saved state (♡ / ♥) and confirms each change with a toast. A header link shows the live saved count and opens a `/wishlist` page listing each saved product with its image, description and price, plus **Add to cart** and **Remove** actions and an empty state that links back to the shop. The wishlist is stored in the browser's local storage, so it survives reloads and requires no sign-in, but it is per-device and is not synced between browsers. On phones the header link collapses to an icon with a 44px touch target.
- **FR-18 Installable mobile web app:** Customers can install The Bathany as a progressive web app from the HTTPS storefront on Android (Chrome) and iPhone/iPad (Safari). The footer provides platform-specific installation links; Android offers the native browser install prompt when available and manual steps otherwise, while iOS explains Safari's Share → Add to Home Screen flow. The installed app uses the Bathany icon and standalone display. The service worker caches the application shell and static assets, not customer/API responses; sign-in, stock and checkout require a network connection. This is not an App Store or Play Store package.
- **FR-19 Animated loading splash:** While the application bundle is downloading and Angular is bootstrapping, a branded full-screen splash shows the Bathany logo with animated rings and progress dots. Its markup and styles are inlined in `index.html` so it paints on the first frame, before any stylesheet or script is fetched. It is held briefly so it never flashes on a fast connection, then fades out and is removed from the DOM once the app has rendered — including when bootstrap fails, so an error can never leave the user staring at a permanent splash. Animations are disabled under `prefers-reduced-motion`.
- **FR-20 Admin activity and order alerts:** The admin console polls `GET /api/admin/notifications` every 20 seconds for audit activity newer than the last seen id, and announces new customer activity and orders with a bell sound plus an on-screen banner naming the event; the dashboard tables refresh at the same time. New orders take priority in the banner text. The first poll only establishes a cursor, so opening the console never replays historic events, and each batch rings once rather than once per row. The endpoint is admin-only (customers receive 403, anonymous callers 401). The alert tone is synthesised with the Web Audio API, so it adds no asset to download or cache. Because browsers block autoplaying audio, the sound is armed by the admin's first interaction with the console and silently skipped until then. A bell button mutes and unmutes alerts, and the preference persists per device. This is an in-console alert while the admin has the console open; it is not a push notification and does not alert a closed app.
- **FR-21 Installed app launch screen:** When the app is launched from a device home screen, the same branded loading experience is shown rather than a blank white screen. On Android the launch screen is derived automatically from the web manifest's name, `background_color` and 512px icon. iOS does not read the manifest for this purpose, so an exact-resolution `apple-touch-startup-image` is supplied for each supported iPhone and iPad in both orientations; these are generated from the brand logo by `apps/web/scripts/generate-ios-splash.mjs` and are styled to match the in-page splash so the handoff to the running app is seamless. The splash logo is prefetched by the service worker, so the launch screen and first paint render correctly even on a cold or offline start.
- **FR-22 About Us page:** A public `/about` page tells the brand story so customers can judge who they are buying from. It covers how The Bathany started, how the products are made, and the direction the brand is taking, alongside the values it commits to (ingredient transparency, gentle formulation, no animal testing, small-batch production) and answers to common questions about origin, cruelty-free status, collection size, shipping and contact. The page is reachable from the top bar, the main navigation and the footer, and closes with a call to action into the shop. It reuses the existing content-page layout, so it stacks to a single column on phones with no horizontal scrolling.

- **FR-23 Contact Us page:** A public `/contact` page, linked from the footer, gives customers a single clear route to reach the business. It presents the support email address (`support@bathany.com`) as the primary channel and routes three other common intents to the place that answers them fastest: order queries to the customer's order history, ingredient and sensitivity queries to the Ingredients page, and product-care queries to the Care guide. It also answers the questions most likely to precede an email — expected response time, where to find an order number, whether an order can be changed or cancelled, wholesale enquiries, and damaged deliveries — and closes with a direct `mailto:` call to action. It reuses the existing content-page layout, so it stacks to a single column on phones with no horizontal scrolling, and each contact link meets the 44px minimum touch-target height.

- **FR-24 Razorpay payment gateway and payment history:** Customers can pay for real with Razorpay (UPI, cards, netbanking and wallets). Whenever the server has gateway keys configured, Razorpay is the **only** payment method offered: the simulated card, wallet and cash-on-delivery methods are development fallbacks and are withheld from both the method list and the checkout endpoint, so an attempt to select one by crafting a request is rejected server-side rather than merely hidden in the interface. If no keys are present the Razorpay option disappears and the simulated gateway continues to work unchanged, so the site never breaks because of a missing key. The order amount is always recomputed on the server from live database prices — the browser never states what it should pay. A completed payment is accepted only after four server-side checks: the HMAC-SHA256 signature is verified in fixed time against the key secret, the payment is re-fetched directly from Razorpay to establish its true status, the payment's order id is confirmed to match the order the customer opened, and the amount is confirmed to the paisa. A payment id that has already been used cannot be claimed by a second order. Verification happens before any stock is reserved, so a rejected payment leaves stock and the order book untouched. Authorised-but-not-captured payments create the order in an awaiting-payment state rather than a paid one. Customers can review every payment on a `/payments` page, linked from My Orders, showing amount, status, method, provider, gateway reference, refunded amount and the related order. Administrators get a Payments section in the console listing all payments across customers with captured, failed, pending, refunded and online-versus-offline totals for reconciliation, and filters by status, provider and free-text search on customer or reference. Refund amounts are recorded and displayed but are not yet issued from the console. Keys are supplied only as environment variables and are never committed; the test keys in use today must be replaced with KYC-activated live keys before taking real money.

- **FR-25 Saved address book:** Customers keep a reusable address book instead of re-typing delivery details at every order. Checkout lists every saved address, marks the default one and preselects it, so the common case needs no input at all; another address can be chosen with a single click. An "Add new address" button opens the same validated form used at checkout, and each saved address can be edited, removed, or promoted to default in place. Exactly one address is default at any time: the first address a customer saves becomes their default automatically, promoting one demotes the previous holder, and deleting the default promotes the next most recently updated address so checkout is never left with nothing preselected. A customer's first order can still be placed by typing an address directly; it is then saved as their default for next time. Addresses are stored server-side and scoped to the signed-in customer, so they follow the customer across devices and the mobile app, and one customer can neither read nor modify another's addresses. The address book is kept separate from the per-order shipping address: orders retain a snapshot of the address they were actually shipped to, so editing or deleting a saved address never rewrites shipping history. Saved addresses are validated by the same rules as checkout, so a stored address can never fail at payment time.

- **FR-26 Order email notifications:** Customers are emailed when an order is placed and whenever its status changes, so they are never left guessing about an order they have paid for. The confirmation email itemises the order, shows the total and repeats the delivery address; status emails explain in plain language what the new status means (payment received, being packed, on its way, delivered, cancelled, refunded) and link to the customer's order history. Administrators are emailed separately whenever a new order is placed, with the customer, items, total and delivery address, so orders are noticed without watching the console. Mail is sent over SMTP from an unattended `donotreply@` address with a monitored reply-to, and recipients are configurable. Email is strictly best-effort and never blocks commerce: confirmation is sent only after the order is committed, and a mail failure is logged without failing a checkout the customer has already paid for or blocking an administrator's status change. When no SMTP credentials are configured the feature switches itself off silently and the rest of the site is unaffected.

- **FR-27 Persistent installed-app sessions:** Installed PWA users stay signed in across access-token expiry using a server-backed, revocable session and an HttpOnly refresh cookie. Access tokens remain short lived. Explicit logout and password resets revoke app sessions. Normal browser login retains its existing duration. Uninstall or clearing site data may remove credentials, but PWA uninstall cannot be reliably detected by the server and some platforms retain browser storage.
- **FR-28 Admin mobile push:** Administrators may opt in to Web Push on supported devices to receive notifications for recorded user activity and orders even when the console is closed. Subscription and delivery require current admin privileges. Push payloads exclude user emails, addresses, IPs, and other personal details; tapping a notification opens the admin console. Permission is requested only after an explicit admin action. Delivery state survives server restarts. iOS requires a supported home-screen installation and platform notification permission.
- **FR-29 Offer banners:** Admins can upload promotional images, add titles/descriptions, enable or disable offers, and specify start/end times. Public Home and Shop pages display only enabled banners inside the UTC validity window with a Shop now link. End time is exclusive. Open pages refresh offers periodically and hide expired banners. This release provides promotional banners only, not coupon redemption or discounted checkout pricing.

## 7. Business rules

1. Product prices and names are snapshotted into order items at order creation.
2. An order may be placed only when all requested quantities are available; stock is reserved/decremented transactionally.
3. Money is stored as decimal SQL values and serialized with explicit currency; floating-point arithmetic is not used for totals. The trading currency is **Indian Rupee (INR, ₹)**, formatted with the `en-IN` locale (for example `₹1,299.00`). The active currency is published by `GET /api/admin/config` so it is configurable in one place.
4. Valid order transitions are `Pending → Paid → Processing → Shipped → Delivered`; `Cancelled`, `Refunded` and `PaymentFailed` are terminal. Declines leave no paid order. The allowed status list is served by `GET /api/admin/config`.
5. A dummy payment never accepts or stores PAN/CVV. Test inputs select outcomes by documented token values.
6. A checkout is rejected before any charge is attempted if the shipping address is missing or invalid, so a declined or failed payment can never leave an order without a deliverable address.
6. Audit records are append-only from application code; personally sensitive values are redacted.
7. Deleting products is represented by archival when referenced by an order.

## 8. Data model

Core tables: `Users`, `Roles`, `UserRoles`, `Categories`, `Products`, `ProductImages`, `Orders`, `OrderItems`, `Payments`, `OrderStatusHistory`, and `AuditActivities`.

All tables use stable keys, UTC timestamps, optimistic concurrency where needed, foreign keys, and indexes for catalog search, order lookup, status, and activity time. A migration pipeline is preferred for deployment; the checked-in SQL script is also usable for local/bootstrap environments.

## 9. Non-functional requirements

- **Security:** HTTPS in deployed environments, secure password hashing, short-lived access tokens, secret configuration outside source control, strict validation, parameterized EF queries, rate limiting at the edge, and admin authorization tests.
- **Reliability:** health/readiness endpoints, transactional checkout, idempotent order creation, centralized exception mapping, and no silent payment failures.
- **Performance:** paginated catalog/order APIs, indexed filters, compressed static assets, and lazy-loaded admin routes.
- **Observability:** structured logs, correlation IDs, health checks, audit events, and actionable error codes.
- **Accessibility:** keyboard navigation, labels, focus states, semantic headings, adequate contrast, and responsive layouts.
- **Privacy:** least-privilege access, no payment credentials, export/delete policy to be finalized before launch.
- **Deployment:** separate Angular static hosting, API service, and SQL instance; environment-specific configuration and repeatable migrations.

## 10. API surface (initial)

| Area | Endpoints |
| --- | --- |
| Catalog | `GET /api/products`, `GET /api/products/{id}`, `GET /api/categories` |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh` |
| Cart/checkout | `GET/POST/PUT/DELETE /api/cart`, `POST /api/checkout` |
| Orders | `GET /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/cancel` |
| Admin | `GET /api/admin/config`, `GET /api/admin/stats`, `GET/POST/PUT/DELETE /api/admin/products`, `GET /api/admin/orders`, `PUT /api/admin/orders/{id}/status`, `GET /api/admin/users`, `PUT /api/admin/users/{id}/role`, `POST /api/admin/users/{id}/reset-password`, `GET /api/admin/activity` |
| Platform | `GET /health`, `GET /ready` |

Responses use consistent validation and problem-details errors. OpenAPI is the contract for generated clients and integration tests.

## 11. Acceptance criteria

- Guest can browse seeded products and search by name/category.
- Customer can add multiple products, change quantities, and receive server-calculated totals.
- Approved dummy payment creates one paid order and decrements stock exactly once.
- Declined/failed payment returns a clear error and does not create a paid order.
- Customer cannot read another customer’s order.
- Non-admin callers receive `401/403` for admin endpoints.
- Admin can perform product and order changes and see corresponding audit entries.
- Restarting the API preserves users, products, orders, and audit data in SQL.
- Production configuration contains no hard-coded secrets or real payment credentials.

## 12. Delivery plan

1. Foundation: repository structure, API contract, database schema/seed, environment files, health checks.
2. Vertical slice: catalog → cart → checkout → dummy payment → order history.
3. Identity and authorization hardening.
4. Admin product/order/user/activity workflows.
5. Automated tests, security review, accessibility pass, deployment manifests, and operational runbook.

## 13. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Legacy template and new SPA diverge | Isolate new app and preserve assets; migrate page by page |
| Overselling under concurrency | Transactional stock update and conflict handling |
| Demo payment mistaken for production | Explicit provider name, test-only configuration, and no card storage |
| Admin data exposure | Server-side role policies, audit trail, and redaction |
| Scope expansion | Gate real payments, shipping, tax, and promotions behind follow-up releases |
