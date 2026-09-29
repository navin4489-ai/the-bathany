-- Adds IP address and device (user agent) to the activity log, plus indexes for the
-- admin activity filters. Safe to run repeatedly.
USE Eshopper;
GO

IF COL_LENGTH('dbo.AuditActivities', 'IpAddress') IS NULL
    ALTER TABLE dbo.AuditActivities ADD IpAddress NVARCHAR(64) NOT NULL CONSTRAINT DF_AuditActivities_IpAddress DEFAULT '';
GO
IF COL_LENGTH('dbo.AuditActivities', 'UserAgent') IS NULL
    ALTER TABLE dbo.AuditActivities ADD UserAgent NVARCHAR(300) NOT NULL CONSTRAINT DF_AuditActivities_UserAgent DEFAULT '';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditActivities_UserId' AND object_id = OBJECT_ID('dbo.AuditActivities'))
    CREATE INDEX IX_AuditActivities_UserId ON dbo.AuditActivities(UserId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditActivities_Action' AND object_id = OBJECT_ID('dbo.AuditActivities'))
    CREATE INDEX IX_AuditActivities_Action ON dbo.AuditActivities(Action);
GO
