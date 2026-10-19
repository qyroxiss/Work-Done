/*
  WorkDone Management System - client registry
  Run ONLY against the main database (WorkDoneDB), after schema.sql.

  Every client company has its own database with the tables from schema.sql. The Client ID
  entered at login is looked up here to find that company's database. The main database is
  itself the database of the first client registered during setup.

  The script is idempotent.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.Clients', N'U') IS NULL
CREATE TABLE dbo.Clients (
    ClientId      NVARCHAR(30)  NOT NULL CONSTRAINT PK_Clients PRIMARY KEY,  -- stored upper-case
    CompanyName   NVARCHAR(150) NOT NULL,
    DatabaseName  NVARCHAR(128) NOT NULL CONSTRAINT UQ_Clients_DatabaseName UNIQUE,
    IsActive      BIT           NOT NULL CONSTRAINT DF_Clients_IsActive DEFAULT (1),
    CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Clients_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Clients_UpdatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* Upgrade from the single-company version: register the configured company as the first client */
IF NOT EXISTS (SELECT 1 FROM dbo.Clients) AND OBJECT_ID(N'dbo.AppSettings', N'U') IS NOT NULL
    INSERT INTO dbo.Clients (ClientId, CompanyName, DatabaseName)
    SELECT UPPER(c.SettingValue), ISNULL(n.SettingValue, c.SettingValue), DB_NAME()
    FROM dbo.AppSettings c
    LEFT JOIN dbo.AppSettings n ON n.SettingKey = N'CompanyName'
    WHERE c.SettingKey = N'ClientId' AND NULLIF(LTRIM(c.SettingValue), N'') IS NOT NULL;
GO
