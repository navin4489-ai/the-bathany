using Eshopper.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Eshopper.Api.Infrastructure;
public class ShopDbContext(DbContextOptions<ShopDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>(); public DbSet<Category> Categories => Set<Category>();
    public DbSet<Product> Products => Set<Product>(); public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>(); public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<AuditActivity> AuditActivities => Set<AuditActivity>();
    public DbSet<ProductImage> ProductImages => Set<ProductImage>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<ShippingAddress> ShippingAddresses => Set<ShippingAddress>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(x => x.Email).IsUnique();
        b.Entity<PasswordResetToken>().HasIndex(x => x.TokenHash);
        b.Entity<Order>().HasIndex(x => new { x.UserId, x.IdempotencyKey }).IsUnique();
        b.Entity<Product>().Property(x => x.Price).HasPrecision(18, 2);
        b.Entity<Order>().Property(x => x.Total).HasPrecision(18, 2);
        b.Entity<Payment>().Property(x => x.Amount).HasPrecision(18, 2);
        b.Entity<OrderItem>().Property(x => x.UnitPrice).HasPrecision(18, 2);
        b.Entity<Order>().HasMany(x => x.Items).WithOne().HasForeignKey(x => x.OrderId);
        b.Entity<Order>().HasOne(x => x.Payment).WithOne().HasForeignKey<Payment>(x => x.OrderId);
        b.Entity<Order>().HasOne(x => x.ShippingAddress).WithOne().HasForeignKey<ShippingAddress>(x => x.OrderId);
        b.Entity<Category>().HasData(new Category { Id = 1, Name = "Bath Rituals" }, new Category { Id = 2, Name = "Whipped Soaps" });
        b.Entity<User>().HasData(new User { Id = 1, Email = "admin@eshopper.local", DisplayName = "Store Admin", PasswordHash = "pbkdf2-sha256$120000$AAAAAAAAAAAAAAAAAAAAAA==$kX0KA5ypCZRdRwh7WSQbRvTskwDcvaj+dluN4LtUvzo=", Role = "Admin", CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
        b.Entity<Product>().HasData(
            new Product { Id = 1, Name = "Potion No. 04", Description = "Botanical bath ritual whipped with rose petals and moonlit florals. Sealed with a charm and a velvet ribbon.", Price = 1299m, Stock = 100, CategoryId = 1, ImageUrl = "assets/brand/product-1.jpeg" },
            new Product { Id = 2, Name = "Chai Spice Soul Whipped Soap", Description = "Warm cardamom, clove and vanilla whipped into a cloud-soft soap, wrapped in a hand block-printed pouch.", Price = 1499m, Stock = 50, CategoryId = 2, ImageUrl = "assets/brand/product-2.jpeg" },
            new Product { Id = 3, Name = "Raspberry Swirl Bath Cloud", Description = "Pure and whimsical whipped bath cloud, served with a little wooden spoon. Scoop, swirl and soak.", Price = 1699m, Stock = 30, CategoryId = 1, ImageUrl = "assets/brand/product-3.jpeg" },
            new Product { Id = 4, Name = "Whipped Soap Boba", Description = "Rose and coconut whipped soap topped with gently exfoliating boba pearls. 250ml of pure indulgence.", Price = 899m, Stock = 40, CategoryId = 2, ImageUrl = "assets/brand/product-4.jpeg" });
    }
}
