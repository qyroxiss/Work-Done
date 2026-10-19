/*
  Creates the WorkDoneDB database and a dedicated application login.
  Run once as a SQL Server administrator (e.g. in SSMS connected to the target instance).

  !! Replace the password below with a strong secret before running, and store it
     only in the backend .env file (never in source control). !!
*/
IF DB_ID(N'WorkDoneDB') IS NULL
    CREATE DATABASE WorkDoneDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'workdone_app')
    CREATE LOGIN workdone_app WITH PASSWORD = N'CHANGE_ME_To_A_Strong_Password!1', CHECK_POLICY = ON;
GO

USE WorkDoneDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'workdone_app')
    CREATE USER workdone_app FOR LOGIN workdone_app;
GO

/* Least privilege for routine application use: read/write data only, no DDL. */
ALTER ROLE db_datareader ADD MEMBER workdone_app;
ALTER ROLE db_datawriter ADD MEMBER workdone_app;
GO

/*
  Run schema.sql and indexes.sql using an administrator / db_owner account
  (or temporarily grant db_ddladmin to the setup account), NOT the app login.
*/
