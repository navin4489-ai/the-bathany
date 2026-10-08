-- Persistent per-device audit cursor/outbox. Apply before enabling the push worker.
USE Eshopper;
GO
IF OBJECT_ID('dbo.PushSubscriptions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PushSubscriptions (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UserId INT NOT NULL,
        AppSessionId UNIQUEIDENTIFIER NULL,
        Endpoint NVARCHAR(2048) NOT NULL,
        EndpointHash NVARCHAR(64) NOT NULL,
        P256dh NVARCHAR(87) NOT NULL,
        Auth NVARCHAR(22) NOT NULL,
        LastActivityId INT NOT NULL DEFAULT 0,
        PendingThroughId INT NULL,
        PendingCount INT NOT NULL DEFAULT 0,
        FailureCount INT NOT NULL DEFAULT 0,
        Suspended BIT NOT NULL DEFAULT 0,
        NextAttemptAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        LeaseUntil DATETIME2 NULL,
        Version NVARCHAR(32) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_PushSubscriptions_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IX_PushSubscriptions_EndpointHash ON dbo.PushSubscriptions(EndpointHash);
    CREATE INDEX IX_PushSubscriptions_UserId ON dbo.PushSubscriptions(UserId);
    CREATE INDEX IX_PushSubscriptions_Suspended_NextAttemptAt ON dbo.PushSubscriptions(Suspended, NextAttemptAt);
END;
GO
IF COL_LENGTH('dbo.PushSubscriptions', 'AppSessionId') IS NULL
    ALTER TABLE dbo.PushSubscriptions ADD AppSessionId UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushSubscriptions_AppSessionId' AND object_id = OBJECT_ID('dbo.PushSubscriptions'))
    CREATE INDEX IX_PushSubscriptions_AppSessionId ON dbo.PushSubscriptions(AppSessionId);
GO
-- NO ACTION avoids multiple cascade paths through Users -> AppSessions.
IF OBJECT_ID('dbo.AppSessions', 'U') IS NOT NULL
    AND OBJECT_ID('dbo.FK_PushSubscriptions_AppSessions', 'F') IS NULL
    ALTER TABLE dbo.PushSubscriptions ADD CONSTRAINT FK_PushSubscriptions_AppSessions
        FOREIGN KEY (AppSessionId) REFERENCES dbo.AppSessions(Id);
GO
