using System.Security.Cryptography;
using System.Text;

namespace Eshopper.Api.Services;

public interface IPasswordService
{
    string Hash(string password);
    bool Verify(string password, string encoded);
    (string Raw, string Hash) CreateResetToken();
    string HashToken(string rawToken);
    string? Validate(string? password);
}

public class PasswordService : IPasswordService
{
    private const int Iterations = 120_000;

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public bool Verify(string password, string encoded)
    {
        var parts = encoded.Split('$');
        if (parts.Length != 4) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, int.Parse(parts[1]), HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch { return false; }
    }

    /// <summary>Returns the raw token (shown once) and the hash that gets persisted.</summary>
    public (string Raw, string Hash) CreateResetToken()
    {
        var raw = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        return (raw, HashToken(raw));
    }

    public string HashToken(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken ?? ""))).ToLowerInvariant();

    /// <summary>Returns an error message, or null when the password is acceptable.</summary>
    public string? Validate(string? password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 10) return "Password must be at least 10 characters.";
        if (password.Length > 200) return "Password is too long.";
        if (!password.Any(char.IsLetter) || !password.Any(char.IsDigit)) return "Password must contain at least one letter and one number.";
        return null;
    }
}
