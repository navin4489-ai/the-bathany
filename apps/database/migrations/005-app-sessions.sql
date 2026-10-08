-- Apply before deploying installed-app session support.
-- No scheduled expiry: sessions remain valid until revoked or the password changes.
USE Eshopper;
GO
IF OBJECT_ID('dbo.AppSessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppSessions (
        Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        UserId INT NOT NULL,
        TokenHash NVARCHAR(64) NOT NULL,
        PasswordStamp NVARCHAR(64) NOT NULL,
        CreatedAt DATETIME2 NOT NULL,
        LastRenewedAt DATETIME2 NOT NULL,
        RevokedAt DATETIME2 NULL,
        CONSTRAINT FK_AppSessions_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IX_AppSessions_TokenHash ON dbo.AppSessions(TokenHash);
    CREATE INDEX IX_AppSessions_UserId ON dbo.AppSessions(UserId);
END;
GO
