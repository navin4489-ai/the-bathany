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
- **FR-15 Database-backed product images:** Product images are stored as binary rows in the `ProductImages` table, not on the web server's disk, so images survive restarts and stay consistent across multiple instances. Admin uploads are validated by magic bytes (not extension), capped at 4 MB, restricted to JPG/PNG/GIF/WEBP, given a server-generated GUID filename, and recorded with the uploading admin. The stored content type is derived from the verified extension rather than the client-supplied header. Images are served publicly from `GET /api/catalog/images/{id}` with long-lived immutable cache headers, and products reference them by that relative URL. The four catalogue images ship as seed data and are loaded into the database on first start.
- **FR-16 Responsive, mobile-friendly UI:** The storefront and admin console must be fully usable on phones and tablets. Below 900px the main navigation collapses behind a hamburger menu that closes on selection; below 720px the product grid, cart rows, order cards, checkout form and footer stack into a single column; wide admin tables scroll horizontally inside their own container instead of breaking the page. Interactive controls have a minimum 44px touch target and form inputs use a 16px font so iOS does not zoom on focus. No page may scroll horizontally at any viewport from 320px upward.

- **FR-17 Wishlist:** Shoppers can save products for later from a heart control on every product card and from the product detail page. The control reflects saved state (♡ / ♥) and confirms each change with a toast. A header link shows the live saved count and opens a `/wishlist` page listing each saved product with its image, description and price, plus **Add to cart** and **Remove** actions and an empty state that links back to the shop. The wishlist is stored in the browser's local storage, so it survives reloads and requires no sign-in, but it is per-device and is not synced between browsers. On phones the header link collapses to an icon with a 44px touch target.

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
