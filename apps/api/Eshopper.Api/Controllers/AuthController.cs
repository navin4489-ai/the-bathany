using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Eshopper.Api.Domain;
using Eshopper.Api.Infrastructure;
using Eshopper.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace Eshopper.Api.Controllers;

public record LoginRequest(string Email, string Password, bool MobileApp = false);
public record RegisterRequest(string Email, string DisplayName, string Password);
public record ForgotPasswordRequest(string Email);
public record ResetPasswordRequest(string Token, string NewPassword);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

[ApiController, Route("api/auth")]
public class AuthController(ShopDbContext db, IConfiguration config, IPasswordService passwords, AppSessionService sessions, IWebHostEnvironment environment) : ControllerBase
{
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email)) return Problem("Email is required.", statusCode: 400);
        if (passwords.Validate(request.Password) is { } invalid) return Problem(invalid, statusCode: 400);
        var email = request.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(x => x.Email == email)) return Conflict("Email is already registered.");
        var user = new User { Email = email, DisplayName = (request.DisplayName ?? "").Trim(), PasswordHash = passwords.Hash(request.Password), Role = "Customer" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.AuditActivities.Add(new AuditActivity { UserId = user.Id, Action = "Register", Details = $"Account created for {email}" });
        await db.SaveChangesAsync();
        return Created("", new { user.Id, user.Email });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        if (request.MobileApp && !CookieRequestAllowed()) return StatusCode(403, new { code = "app_session_csrf", detail = "App session requests require a trusted origin and X-App-Session: 1." });
        var email = (request.Email ?? "").Trim().ToLowerInvariant();
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Email == email);
        if (user is null || !passwords.Verify(request.Password ?? "", user.PasswordHash))
        {
            db.AuditActivities.Add(new AuditActivity { UserId = user?.Id, Action = "LoginFailed", Details = $"Failed sign-in for {Truncate(email, 200)}" });
            await db.SaveChangesAsync();
            return Unauthorized();
        }
        db.AuditActivities.Add(new AuditActivity { UserId = user.Id, Action = "Login", Details = $"{user.Email} signed in" });
        await db.SaveChangesAsync();
        AppSession? session = null;
        if (request.MobileApp)
        {
            await sessions.RevokeCookieAsync(Request.Cookies[AppSessionService.CookieName], HttpContext.RequestAborted);
            var created = await sessions.CreateAsync(user, HttpContext.RequestAborted);
            session = created.Session;
            WriteSessionCookie(created.Token);
        }
        return IssueAccessToken(user, session);
    }

    private IActionResult IssueAccessToken(User user, AppSession? session = null)
    {
        Response.Headers.CacheControl = "no-store";
        var key = config["Jwt:SigningKey"];
        if (string.IsNullOrWhiteSpace(key)) return Problem("JWT signing key is not configured.");
        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.DisplayName),
            new Claim(ClaimTypes.Role, user.Role)
        };
        if (session is not null) claims.Add(new Claim(AppSessionService.ClaimName, session.Id.ToString()));
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var expires = session is null ? DateTime.UtcNow.AddHours(2) : DateTime.UtcNow.AddMinutes(15);
        var token = new JwtSecurityToken(config["Jwt:Issuer"], config["Jwt:Audience"], claims, expires: expires, signingCredentials: credentials);
        return Ok(new { accessToken = new JwtSecurityTokenHandler().WriteToken(token), user.Id, user.Email, user.DisplayName, user.Role });
    }

    [HttpPost("renew"), AllowAnonymous]
    public async Task<IActionResult> Renew()
    {
        Response.Headers.CacheControl = "no-store";
        if (!CookieRequestAllowed()) return StatusCode(403, new { code = "app_session_csrf" });
        var raw = Request.Cookies[AppSessionService.CookieName];
        var session = await sessions.FindValidAsync(raw, HttpContext.RequestAborted);
        if (session is null)
        {
            DeleteSessionCookie();
            return Unauthorized(new { code = "app_session_invalid", detail = "The app session is missing or has been revoked. Please sign in." });
        }
        await sessions.RenewAsync(session, HttpContext.RequestAborted);
        WriteSessionCookie(raw!);
        return IssueAccessToken(session.User!, session);
    }

    private bool CookieRequestAllowed()
    {
        if (Request.Headers[AppSessionService.CsrfHeader] != "1") return false;
        var origin = Request.Headers.Origin.ToString();
        var ownOrigin = $"{Request.Scheme}://{Request.Host}";
        if (origin.Length > 0 && !string.Equals(origin, ownOrigin, StringComparison.OrdinalIgnoreCase) &&
            !(environment.IsDevelopment() && origin == "http://localhost:4200")) return false;
        return Request.Headers["Sec-Fetch-Site"] != "cross-site";
    }

    private CookieOptions SessionCookieOptions() => new()
    {
        HttpOnly = true, Secure = Request.IsHttps, SameSite = SameSiteMode.Strict,
        Path = "/api/auth", IsEssential = true,
        MaxAge = TimeSpan.FromDays(AppSessionService.CookieDays),
        Expires = DateTimeOffset.UtcNow.AddDays(AppSessionService.CookieDays)
    };

    // Browsers cap persistent cookies and may clear them on uninstall/storage cleanup.
    // The server cannot detect uninstall; each successful renewal extends this bounded lifetime.
    private void WriteSessionCookie(string raw) => Response.Cookies.Append(AppSessionService.CookieName, raw, SessionCookieOptions());
    private void DeleteSessionCookie()
    {
        var options = SessionCookieOptions();
        options.MaxAge = TimeSpan.Zero;
        options.Expires = DateTimeOffset.UnixEpoch;
        Response.Cookies.Append(AppSessionService.CookieName, "", options);
    }

    private static string Truncate(string value, int max) => value.Length > max ? value[..max] : value;

    [HttpPost("logout"), AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        Response.Headers.CacheControl = "no-store";
        var raw = Request.Cookies[AppSessionService.CookieName];
        int? userId = null;
        if (raw is not null)
        {
            if (!CookieRequestAllowed()) return StatusCode(403, new { code = "app_session_csrf" });
            userId = await sessions.RevokeCookieAsync(raw, HttpContext.RequestAborted);
            DeleteSessionCookie();
        }
        if (User.Identity?.IsAuthenticated == true && int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var authenticatedId))
        {
            userId ??= authenticatedId;
            if (Guid.TryParse(User.FindFirstValue(AppSessionService.ClaimName), out var sessionId))
            {
                var session = await db.Set<AppSession>().SingleOrDefaultAsync(s => s.Id == sessionId && s.UserId == authenticatedId);
                if (session is not null) session.RevokedAt ??= DateTime.UtcNow;
                var subscriptions = await db.Set<PushSubscription>()
                    .Where(s => s.AppSessionId == sessionId && s.UserId == authenticatedId)
                    .ToListAsync(HttpContext.RequestAborted);
                db.Set<PushSubscription>().RemoveRange(subscriptions);
            }
        }
        // Cookie logout deliberately works without a valid access token, and is idempotent.
        if (userId is null) return Ok();
        db.AuditActivities.Add(new AuditActivity { UserId = userId, Action = "Logout", Details = "Account signed out" });
        await db.SaveChangesAsync();
        return Ok();
    }

    /// <summary>
    /// Starts a password reset. Always returns 200 so the response cannot be used to discover
    /// which emails are registered. In production the token would be emailed; in the sandbox it
    /// is returned directly so the flow can be tested without a mail server.
    /// </summary>
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request)
    {
        var email = (request.Email ?? "").Trim().ToLowerInvariant();
        var generic = "If that email is registered, a password reset link has been sent.";
        if (string.IsNullOrWhiteSpace(email)) return Ok(new { message = generic });

        var user = await db.Users.SingleOrDefaultAsync(x => x.Email == email);
        if (user is null) return Ok(new { message = generic });

        // Invalidate any outstanding tokens so only the newest one works.
        var outstanding = await db.PasswordResetTokens.Where(t => t.UserId == user.Id && t.UsedAt == null).ToListAsync();
        foreach (var old in outstanding) old.UsedAt = DateTime.UtcNow;

        var (raw, hash) = passwords.CreateResetToken();
        db.PasswordResetTokens.Add(new PasswordResetToken { UserId = user.Id, TokenHash = hash, ExpiresAt = DateTime.UtcNow.AddMinutes(30) });
        db.AuditActivities.Add(new AuditActivity { UserId = user.Id, Action = "PasswordResetRequested", Details = $"Reset requested for {email}" });
        await db.SaveChangesAsync();

        var exposeToken = config.GetValue("Auth:ExposeResetToken", false);
        return exposeToken
            ? Ok(new { message = generic, resetToken = raw, expiresInMinutes = 30, sandboxNote = "Token is returned only because email delivery is not configured." })
            : Ok(new { message = generic });
    }

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Token)) return Problem("Reset token is required.", statusCode: 400);
        if (passwords.Validate(request.NewPassword) is { } invalid) return Problem(invalid, statusCode: 400);

        var hash = passwords.HashToken(request.Token.Trim());
        var token = await db.PasswordResetTokens.SingleOrDefaultAsync(t => t.TokenHash == hash);
        if (token is null || token.UsedAt is not null || token.ExpiresAt < DateTime.UtcNow)
            return Problem("This reset link is invalid or has expired. Please request a new one.", statusCode: 400);

        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == token.UserId);
        if (user is null) return Problem("This reset link is invalid or has expired. Please request a new one.", statusCode: 400);

        user.PasswordHash = passwords.Hash(request.NewPassword);
        token.UsedAt = DateTime.UtcNow;
        await sessions.RevokeAllForUserAsync(user.Id, HttpContext.RequestAborted);
        db.AuditActivities.Add(new AuditActivity { UserId = user.Id, Action = "PasswordReset", Details = $"Password reset for {user.Email}" });
        await db.SaveChangesAsync();
        return Ok(new { message = "Your password has been updated. You can now sign in." });
    }

    [HttpPost("change-password"), Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return Unauthorized();
        if (passwords.Validate(request.NewPassword) is { } invalid) return Problem(invalid, statusCode: 400);

        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId);
        if (user is null) return Unauthorized();
        if (!passwords.Verify(request.CurrentPassword ?? "", user.PasswordHash)) return Problem("Your current password is incorrect.", statusCode: 400);

        user.PasswordHash = passwords.Hash(request.NewPassword);
        await sessions.RevokeAllForUserAsync(user.Id, HttpContext.RequestAborted);
        db.AuditActivities.Add(new AuditActivity { UserId = user.Id, Action = "PasswordChanged", Details = $"Password changed for {user.Email}" });
        await db.SaveChangesAsync();
        return Ok(new { message = "Your password has been changed." });
    }
}
