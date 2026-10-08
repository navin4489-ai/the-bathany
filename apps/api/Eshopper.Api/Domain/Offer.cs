namespace Eshopper.Api.Domain;

public class Offer
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string ImageUrl { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
