-- Adds Razorpay reconciliation columns to Payments.
-- Safe to run repeatedly: every step checks for existence first, so an interrupted
-- run can simply be re-run. Existing rows are backfilled as 'simulated' because
-- they were taken by the test gateway before Razorpay was introduced.
USE Eshopper;
GO

IF COL_LENGTH('dbo.Payments', 'Provider') IS NULL
    ALTER TABLE dbo.Payments ADD Provider NVARCHAR(40) NOT NULL CONSTRAINT DF_Payments_Provider DEFAULT 'simulated';
GO
IF COL_LENGTH('dbo.Payments', 'ProviderOrderId') IS NULL
    ALTER TABLE dbo.Payments ADD ProviderOrderId NVARCHAR(120) NOT NULL CONSTRAINT DF_Payments_ProviderOrderId DEFAULT '';
GO
IF COL_LENGTH('dbo.Payments', 'ProviderPaymentId') IS NULL
    ALTER TABLE dbo.Payments ADD ProviderPaymentId NVARCHAR(120) NOT NULL CONSTRAINT DF_Payments_ProviderPaymentId DEFAULT '';
GO
IF COL_LENGTH('dbo.Payments', 'Currency') IS NULL
    ALTER TABLE dbo.Payments ADD Currency NVARCHAR(10) NOT NULL CONSTRAINT DF_Payments_Currency DEFAULT 'INR';
GO
IF COL_LENGTH('dbo.Payments', 'RefundedAmount') IS NULL
    ALTER TABLE dbo.Payments ADD RefundedAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_Payments_RefundedAmount DEFAULT 0;
GO
IF COL_LENGTH('dbo.Payments', 'UpdatedAt') IS NULL
    ALTER TABLE dbo.Payments ADD UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Payments_UpdatedAt DEFAULT SYSUTCDATETIME();
GO

-- Historic rows predate the column defaults, so set them explicitly.
UPDATE dbo.Payments SET Provider = 'simulated' WHERE Provider IS NULL OR Provider = '';
UPDATE dbo.Payments SET Currency = 'INR' WHERE Currency IS NULL OR Currency = '';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Payments_ProviderOrderId' AND object_id = OBJECT_ID('dbo.Payments'))
    CREATE INDEX IX_Payments_ProviderOrderId ON dbo.Payments(ProviderOrderId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Payments_ProviderPaymentId' AND object_id = OBJECT_ID('dbo.Payments'))
    CREATE INDEX IX_Payments_ProviderPaymentId ON dbo.Payments(ProviderPaymentId);
GO
