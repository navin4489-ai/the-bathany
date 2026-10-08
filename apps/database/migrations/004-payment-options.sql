-- Apply before deploying the payment-option admin controls.
USE Eshopper;
GO
IF OBJECT_ID('dbo.PaymentOptions', 'U') IS NULL
    CREATE TABLE dbo.PaymentOptions (
        Code NVARCHAR(40) NOT NULL PRIMARY KEY,
        Enabled BIT NOT NULL DEFAULT 1
    );
GO
IF NOT EXISTS (SELECT 1 FROM dbo.PaymentOptions WHERE Code = 'razorpay')
    INSERT INTO dbo.PaymentOptions (Code, Enabled) VALUES ('razorpay', 1);
GO
