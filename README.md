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

The shop automatically falls back to deterministic local catalog data when the API is unavailable. Cart state is kept in local storage. API endpoints cover catalog, checkout (with deterministic dummy payment), and admin products/orders/users/activity; wire a real identity provider and payment gateway before production. Register via `POST /api/auth/register`, then login. Checkout requires a bearer token and uses `test_approved`, `test_declined`, or `test_error` as deterministic payment tokens. Every checkout must provide a unique idempotency key; retries safely return the original order.
