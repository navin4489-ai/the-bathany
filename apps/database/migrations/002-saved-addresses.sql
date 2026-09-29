-- Adds the shopper address book.
-- Safe to run repeatedly: the table and index are only created when missing.
-- Deliberately separate from ShippingAddresses, which snapshots the address an
-- order was actually shipped to and must never change when a saved address is edited.
USE Eshopper;
GO

IF OBJECT_ID('dbo.SavedAddresses', 'U') IS NULL
    CREATE TABLE dbo.SavedAddresses (
        Id INT IDENTITY PRIMARY KEY,
        UserId INT NOT NULL REFERENCES dbo.Users(Id),
        FullName NVARCHAR(120) NOT NULL,
        Phone NVARCHAR(20) NOT NULL,
        Line1 NVARCHAR(200) NOT NULL,
        Line2 NVARCHAR(200) NOT NULL DEFAULT '',
        City NVARCHAR(100) NOT NULL,
        State NVARCHAR(100) NOT NULL,
        PostalCode NVARCHAR(10) NOT NULL,
        Country NVARCHAR(100) NOT NULL DEFAULT 'India',
        Landmark NVARCHAR(200) NOT NULL DEFAULT '',
        IsDefault BIT NOT NULL DEFAULT 0,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SavedAddresses_UserId' AND object_id = OBJECT_ID('dbo.SavedAddresses'))
    CREATE INDEX IX_SavedAddresses_UserId ON dbo.SavedAddresses(UserId);
GO
