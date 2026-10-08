USE Eshopper;
GO
IF OBJECT_ID('dbo.Offers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Offers (
        Id INT IDENTITY PRIMARY KEY,
        Title NVARCHAR(120) NOT NULL,
        Description NVARCHAR(1000) NOT NULL DEFAULT '',
        ImageUrl NVARCHAR(200) NOT NULL,
        Enabled BIT NOT NULL DEFAULT 1,
        StartsAt DATETIME2 NOT NULL,
        EndsAt DATETIME2 NOT NULL,
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_Offers_Schedule CHECK (EndsAt > StartsAt)
    );
    CREATE INDEX IX_Offers_Enabled_StartsAt_EndsAt ON dbo.Offers(Enabled, StartsAt, EndsAt);
END;
GO
