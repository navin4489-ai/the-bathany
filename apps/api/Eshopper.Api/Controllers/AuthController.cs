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

public record LoginRequest(string Email, string Password);
public record RegisterRequest(string Email, string DisplayName, string Password);
public record ForgotPasswordRequest(string Email);
public record ResetPasswordRequest(string Token, string NewPassword);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

[ApiController, Route("api/auth")]
public class AuthController(ShopDbContext db, IConfiguration config, IPasswordService passwords) : ControllerBase
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
        var key = config["Jwt:SigningKey"];
        if (string.IsNullOrWhiteSpace(key)) return Problem("JWT signing key is not configured.");
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.DisplayName),
            new Claim(ClaimTypes.Role, user.Role)
        };
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(config["Jwt:Issuer"], config["Jwt:Audience"], claims, expires: DateTime.UtcNow.AddHours(2), signingCredentials: credentials);
        return Ok(new { accessToken = new JwtSecurityTokenHandler().WriteToken(token), user.Id, user.Email, user.DisplayName, user.Role });
    }

    private static string Truncate(string value, int max) => value.Length > max ? value[..max] : value;

    /// <summary>JWTs are stateless, so this only records the sign-out; the client discards its token.</summary>
    [HttpPost("logout"), Authorize]
    public async Task<IActionResult> Logout()
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return Unauthorized();
        db.AuditActivities.Add(new AuditActivity { UserId = userId, Action = "Logout", Details = $"{User.FindFirstValue(ClaimTypes.Email)} signed out" });
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
        db.AuditActivities.Add(new AuditActivity { UserId = user.Id, Action = "PasswordChanged", Details = $"Password changed for {user.Email}" });
        await db.SaveChangesAsync();
        return Ok(new { message = "Your password has been changed." });
    }
}
