/*
  WorkDone Management System - schema
  Target: SQL Server 2019 / 2022 / 2025 (uses OFFSET/FETCH and filtered indexes).

  Run against the WorkDoneDB database, e.g. in SSMS:
      CREATE DATABASE WorkDoneDB;   -- once, if it does not exist
      USE WorkDoneDB;
      -- then execute this file, followed by indexes.sql and (for development) seed.sql

  The script is idempotent: tables are created only if they do not already exist.
  Schema changes after go-live should be added as new versioned scripts in database/migrations.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Employees ---------- */
IF OBJECT_ID(N'dbo.Employees', N'U') IS NULL
CREATE TABLE dbo.Employees (
    EmployeeId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Employees PRIMARY KEY,
    EmployeeCode  NVARCHAR(20)  NOT NULL CONSTRAINT UQ_Employees_EmployeeCode UNIQUE,
    EmployeeName  NVARCHAR(100) NOT NULL,
    Department    NVARCHAR(100) NULL,
    Phone         NVARCHAR(30)  NULL,
    Email         NVARCHAR(150) NULL,
    JoiningDate   DATE          NULL,
    IsActive      BIT           NOT NULL CONSTRAINT DF_Employees_IsActive DEFAULT (1),
    CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Employees_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Employees_UpdatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Users ---------- */
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
CREATE TABLE dbo.Users (
    UserId              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    ClientId            NVARCHAR(30)  NULL,  -- client company (see dbo.Clients in the main database); filled when the client is registered
    Username            NVARCHAR(50)  NOT NULL CONSTRAINT UQ_Users_Username UNIQUE,
    Email               NVARCHAR(150) NULL,  -- optional; can be used instead of the username to log in
    PasswordHash        NVARCHAR(255) NOT NULL,
    Role                NVARCHAR(20)  NOT NULL CONSTRAINT CK_Users_Role CHECK (Role IN (N'Admin', N'Manager', N'Employee')),
    EmployeeId          INT           NULL CONSTRAINT FK_Users_Employees REFERENCES dbo.Employees (EmployeeId),
    MustChangePassword  BIT           NOT NULL CONSTRAINT DF_Users_MustChangePassword DEFAULT (1),
    IsActive            BIT           NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
    LastLoginAt         DATETIME2(0)  NULL,
    CreatedAt           DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt           DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    -- Employee accounts must be linked to an employee record
    CONSTRAINT CK_Users_EmployeeLink CHECK (Role <> N'Employee' OR EmployeeId IS NOT NULL)
);
GO

/* Upgrade from v1: login by email */
IF COL_LENGTH(N'dbo.Users', N'Email') IS NULL
    ALTER TABLE dbo.Users ADD Email NVARCHAR(150) NULL;
GO

/* Upgrade: users belong to a client company (Client ID entered at login) */
IF COL_LENGTH(N'dbo.Users', N'ClientId') IS NULL
    ALTER TABLE dbo.Users ADD ClientId NVARCHAR(30) NULL;
GO

/* ---------- Application settings (company name, Client ID, ...) ---------- */
IF OBJECT_ID(N'dbo.AppSettings', N'U') IS NULL
CREATE TABLE dbo.AppSettings (
    SettingKey    NVARCHAR(50)  NOT NULL CONSTRAINT PK_AppSettings PRIMARY KEY,
    SettingValue  NVARCHAR(500) NULL,
    UpdatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_AppSettings_UpdatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Product groups ---------- */
IF OBJECT_ID(N'dbo.ProductGroups', N'U') IS NULL
CREATE TABLE dbo.ProductGroups (
    ProductGroupId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProductGroups PRIMARY KEY,
    GroupCode       NVARCHAR(20)  NOT NULL CONSTRAINT UQ_ProductGroups_GroupCode UNIQUE,
    GroupName       NVARCHAR(100) NOT NULL,
    Description     NVARCHAR(500) NULL,
    IsActive        BIT           NOT NULL CONSTRAINT DF_ProductGroups_IsActive DEFAULT (1),
    CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_ProductGroups_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_ProductGroups_UpdatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Products ---------- */
IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
CREATE TABLE dbo.Products (
    ProductId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    ProductCode     NVARCHAR(20)  NOT NULL CONSTRAINT UQ_Products_ProductCode UNIQUE,
    ProductName     NVARCHAR(150) NOT NULL,
    ProductGroupId  INT           NOT NULL CONSTRAINT FK_Products_ProductGroups REFERENCES dbo.ProductGroups (ProductGroupId),
    Description     NVARCHAR(500) NULL,
    IsActive        BIT           NOT NULL CONSTRAINT DF_Products_IsActive DEFAULT (1),
    CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_Products_UpdatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Work items ---------- */
IF OBJECT_ID(N'dbo.WorkItems', N'U') IS NULL
CREATE TABLE dbo.WorkItems (
    WorkId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkItems PRIMARY KEY,
    -- Human-readable number derived from the identity, e.g. WD-000042
    WorkNo           AS (CAST(N'WD-' + CASE WHEN WorkId < 1000000
                                            THEN RIGHT(N'000000' + CAST(WorkId AS NVARCHAR(10)), 6)
                                            ELSE CAST(WorkId AS NVARCHAR(10)) END AS NVARCHAR(20))) PERSISTED,
    Title            NVARCHAR(200) NOT NULL,
    Description      NVARCHAR(MAX) NULL,
    ProductGroupId   INT           NULL CONSTRAINT FK_WorkItems_ProductGroups REFERENCES dbo.ProductGroups (ProductGroupId),
    ProductId        INT           NULL CONSTRAINT FK_WorkItems_Products REFERENCES dbo.Products (ProductId),
    Priority         NVARCHAR(10)  NOT NULL CONSTRAINT DF_WorkItems_Priority DEFAULT (N'Medium')
                                   CONSTRAINT CK_WorkItems_Priority CHECK (Priority IN (N'Low', N'Medium', N'High', N'Urgent')),
    Status           NVARCHAR(20)  NOT NULL CONSTRAINT DF_WorkItems_Status DEFAULT (N'Pending')
                                   CONSTRAINT CK_WorkItems_Status CHECK (Status IN (N'Pending', N'In Progress', N'On Hold', N'Completed', N'Closed', N'Reopened')),
    StartDate        DATE          NULL,
    DueDate          DATE          NULL,
    CreatedByUserId  INT           NOT NULL CONSTRAINT FK_WorkItems_CreatedBy REFERENCES dbo.Users (UserId),
    CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_WorkItems_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_WorkItems_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    ClosedAt         DATETIME2(0)  NULL,
    -- Optimistic concurrency token: changes on every update
    RowVer           ROWVERSION    NOT NULL,
    CONSTRAINT CK_WorkItems_Dates CHECK (StartDate IS NULL OR DueDate IS NULL OR DueDate >= StartDate)
);
GO

/* ---------- Work assignments (one work item -> many employees) ---------- */
IF OBJECT_ID(N'dbo.WorkAssignments', N'U') IS NULL
CREATE TABLE dbo.WorkAssignments (
    AssignmentId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkAssignments PRIMARY KEY,
    WorkId              INT          NOT NULL CONSTRAINT FK_WorkAssignments_WorkItems REFERENCES dbo.WorkItems (WorkId),
    EmployeeId          INT          NOT NULL CONSTRAINT FK_WorkAssignments_Employees REFERENCES dbo.Employees (EmployeeId),
    AssignedByUserId    INT          NOT NULL CONSTRAINT FK_WorkAssignments_AssignedBy REFERENCES dbo.Users (UserId),
    AssignedAt          DATETIME2(0) NOT NULL CONSTRAINT DF_WorkAssignments_AssignedAt DEFAULT (SYSUTCDATETIME()),
    IsActive            BIT          NOT NULL CONSTRAINT DF_WorkAssignments_IsActive DEFAULT (1),
    UnassignedAt        DATETIME2(0) NULL,
    UnassignedByUserId  INT          NULL CONSTRAINT FK_WorkAssignments_UnassignedBy REFERENCES dbo.Users (UserId)
);
GO

/* ---------- Work status history / activity log ---------- */
IF OBJECT_ID(N'dbo.WorkStatusHistory', N'U') IS NULL
CREATE TABLE dbo.WorkStatusHistory (
    HistoryId        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkStatusHistory PRIMARY KEY,
    WorkId           INT            NOT NULL CONSTRAINT FK_WorkStatusHistory_WorkItems REFERENCES dbo.WorkItems (WorkId),
    EntryType        NVARCHAR(20)   NOT NULL CONSTRAINT DF_WorkStatusHistory_EntryType DEFAULT (N'StatusChange')
                                    CONSTRAINT CK_WorkStatusHistory_EntryType CHECK (EntryType IN (N'Created', N'StatusChange', N'Note', N'Assignment', N'Edit')),
    OldStatus        NVARCHAR(20)   NULL,
    NewStatus        NVARCHAR(20)   NOT NULL,
    ChangedByUserId  INT            NOT NULL CONSTRAINT FK_WorkStatusHistory_ChangedBy REFERENCES dbo.Users (UserId),
    Notes            NVARCHAR(2000) NULL,
    ChangedAt        DATETIME2(0)   NOT NULL CONSTRAINT DF_WorkStatusHistory_ChangedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Server-side sessions ---------- */
IF OBJECT_ID(N'dbo.Sessions', N'U') IS NULL
CREATE TABLE dbo.Sessions (
    SessionId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
    TokenHash   CHAR(64)      NOT NULL CONSTRAINT UQ_Sessions_TokenHash UNIQUE,  -- SHA-256 of the cookie token; the raw token is never stored
    UserId      INT           NOT NULL CONSTRAINT FK_Sessions_Users REFERENCES dbo.Users (UserId),
    CreatedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    LastSeenAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_Sessions_LastSeenAt DEFAULT (SYSUTCDATETIME()),
    ExpiresAt   DATETIME2(0)  NOT NULL,
    RevokedAt   DATETIME2(0)  NULL,
    IpAddress   NVARCHAR(64)  NULL,
    UserAgent   NVARCHAR(300) NULL
);
GO

/* ---------- Security event log ---------- */
IF OBJECT_ID(N'dbo.SecurityEvents', N'U') IS NULL
CREATE TABLE dbo.SecurityEvents (
    EventId    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SecurityEvents PRIMARY KEY,
    EventType  NVARCHAR(50)  NOT NULL,
    UserId     INT           NULL,
    Username   NVARCHAR(50)  NULL,
    IpAddress  NVARCHAR(64)  NULL,
    Details    NVARCHAR(500) NULL,
    CreatedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_SecurityEvents_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Chat ---------- */
/* One "Company" conversation (everyone in this client), one "Direct" conversation per pair of users,
   and any number of named "Group" conversations. */
IF OBJECT_ID(N'dbo.ChatConversations', N'U') IS NULL
CREATE TABLE dbo.ChatConversations (
    ConversationId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ChatConversations PRIMARY KEY,
    Kind             NVARCHAR(10)  NOT NULL CONSTRAINT CK_ChatConversations_Kind CHECK (Kind IN (N'Company', N'Direct', N'Group')),
    Title            NVARCHAR(100) NULL,  -- group name
    -- Direct chats: "<lower UserId>:<higher UserId>", so each pair has exactly one conversation
    DirectKey        NVARCHAR(30)  NULL,
    CreatedByUserId  INT           NULL CONSTRAINT FK_ChatConversations_CreatedBy REFERENCES dbo.Users (UserId),
    CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_ChatConversations_CreatedAt DEFAULT (SYSUTCDATETIME()),
    LastMessageAt    DATETIME2(0)  NULL
);
GO

IF OBJECT_ID(N'dbo.ChatMembers', N'U') IS NULL
CREATE TABLE dbo.ChatMembers (
    ConversationId     INT          NOT NULL CONSTRAINT FK_ChatMembers_Conversations REFERENCES dbo.ChatConversations (ConversationId),
    UserId             INT          NOT NULL CONSTRAINT FK_ChatMembers_Users REFERENCES dbo.Users (UserId),
    -- Messages up to this id have been read by the user (drives unread counts)
    LastReadMessageId  BIGINT       NOT NULL CONSTRAINT DF_ChatMembers_LastRead DEFAULT (0),
    JoinedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_ChatMembers_JoinedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_ChatMembers PRIMARY KEY (ConversationId, UserId)
);
GO

IF OBJECT_ID(N'dbo.ChatMessages', N'U') IS NULL
CREATE TABLE dbo.ChatMessages (
    MessageId       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ChatMessages PRIMARY KEY,
    ConversationId  INT            NOT NULL CONSTRAINT FK_ChatMessages_Conversations REFERENCES dbo.ChatConversations (ConversationId),
    SenderUserId    INT            NOT NULL CONSTRAINT FK_ChatMessages_Sender REFERENCES dbo.Users (UserId),
    Body            NVARCHAR(2000) NOT NULL,
    CreatedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_ChatMessages_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* Upgrade: named groups */
IF COL_LENGTH(N'dbo.ChatConversations', N'Title') IS NULL
    ALTER TABLE dbo.ChatConversations ADD Title NVARCHAR(100) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ChatConversations_Kind' AND definition NOT LIKE N'%Group%')
BEGIN
    ALTER TABLE dbo.ChatConversations DROP CONSTRAINT CK_ChatConversations_Kind;
    ALTER TABLE dbo.ChatConversations ADD CONSTRAINT CK_ChatConversations_Kind CHECK (Kind IN (N'Company', N'Direct', N'Group'));
END
GO

/* Upgrade: edited / deleted messages */
IF COL_LENGTH(N'dbo.ChatMessages', N'EditedAt') IS NULL
    ALTER TABLE dbo.ChatMessages ADD EditedAt DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.ChatMessages', N'DeletedAt') IS NULL
    ALTER TABLE dbo.ChatMessages ADD DeletedAt DATETIME2(0) NULL;
GO

/* Files sent in chat (one per message). Kept in the client's own database, so they are
   included in its backups and never visible to other companies. Content is cleared when
   the message is deleted. */
IF OBJECT_ID(N'dbo.ChatAttachments', N'U') IS NULL
CREATE TABLE dbo.ChatAttachments (
    AttachmentId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ChatAttachments PRIMARY KEY,
    MessageId     BIGINT         NOT NULL CONSTRAINT FK_ChatAttachments_Messages REFERENCES dbo.ChatMessages (MessageId),
    FileName      NVARCHAR(255)  NOT NULL,
    ContentType   NVARCHAR(100)  NOT NULL,
    SizeBytes     INT            NOT NULL,
    Content       VARBINARY(MAX) NULL,
    CreatedAt     DATETIME2(0)   NOT NULL CONSTRAINT DF_ChatAttachments_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ---------- Files attached to work items ---------- */
/* Kept in the client's own database like chat files. Deleting a file clears its content but keeps the row
   (and a history entry), so the activity log stays complete. */
IF OBJECT_ID(N'dbo.WorkAttachments', N'U') IS NULL
CREATE TABLE dbo.WorkAttachments (
    AttachmentId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkAttachments PRIMARY KEY,
    WorkId            INT            NOT NULL CONSTRAINT FK_WorkAttachments_WorkItems REFERENCES dbo.WorkItems (WorkId),
    FileName          NVARCHAR(255)  NOT NULL,
    ContentType       NVARCHAR(100)  NOT NULL,
    SizeBytes         INT            NOT NULL,
    Content           VARBINARY(MAX) NULL,
    UploadedByUserId  INT            NOT NULL CONSTRAINT FK_WorkAttachments_UploadedBy REFERENCES dbo.Users (UserId),
    CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_WorkAttachments_CreatedAt DEFAULT (SYSUTCDATETIME()),
    DeletedAt         DATETIME2(0)   NULL,
    DeletedByUserId   INT            NULL CONSTRAINT FK_WorkAttachments_DeletedBy REFERENCES dbo.Users (UserId)
);
GO

/* Upgrade: file uploads appear in the work history */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_WorkStatusHistory_EntryType' AND definition NOT LIKE N'%Attachment%')
BEGIN
    ALTER TABLE dbo.WorkStatusHistory DROP CONSTRAINT CK_WorkStatusHistory_EntryType;
    ALTER TABLE dbo.WorkStatusHistory ADD CONSTRAINT CK_WorkStatusHistory_EntryType
        CHECK (EntryType IN (N'Created', N'StatusChange', N'Note', N'Assignment', N'Edit', N'Attachment'));
END
GO

/* ---------- Repeating work ---------- */
/* A template that creates a new work item every week / month / quarter / year.
   NextDueDate is the due date of the next item to create; the item is created LeadDays before it
   (its start date) by the server's background job. AnchorDay keeps "the 31st" from drifting to the
   28th after February. */
IF OBJECT_ID(N'dbo.RecurringWork', N'U') IS NULL
CREATE TABLE dbo.RecurringWork (
    RecurringId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RecurringWork PRIMARY KEY,
    Title             NVARCHAR(200) NOT NULL,
    Description       NVARCHAR(MAX) NULL,
    ProductGroupId    INT           NULL CONSTRAINT FK_RecurringWork_ProductGroups REFERENCES dbo.ProductGroups (ProductGroupId),
    ProductId         INT           NULL CONSTRAINT FK_RecurringWork_Products REFERENCES dbo.Products (ProductId),
    Priority          NVARCHAR(10)  NOT NULL CONSTRAINT DF_RecurringWork_Priority DEFAULT (N'Medium')
                                    CONSTRAINT CK_RecurringWork_Priority CHECK (Priority IN (N'Low', N'Medium', N'High', N'Urgent')),
    Frequency         NVARCHAR(10)  NOT NULL CONSTRAINT CK_RecurringWork_Frequency CHECK (Frequency IN (N'Weekly', N'Monthly', N'Quarterly', N'Yearly')),
    AnchorDay         TINYINT       NOT NULL,
    NextDueDate       DATE          NOT NULL,
    LeadDays          SMALLINT      NOT NULL CONSTRAINT DF_RecurringWork_LeadDays DEFAULT (7)
                                    CONSTRAINT CK_RecurringWork_LeadDays CHECK (LeadDays BETWEEN 0 AND 90),
    EndDate           DATE          NULL,
    IsActive          BIT           NOT NULL CONSTRAINT DF_RecurringWork_IsActive DEFAULT (1),
    CreatedByUserId   INT           NOT NULL CONSTRAINT FK_RecurringWork_CreatedBy REFERENCES dbo.Users (UserId),
    CreatedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_RecurringWork_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_RecurringWork_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    LastCreatedAt     DATETIME2(0)  NULL
);
GO

IF OBJECT_ID(N'dbo.RecurringWorkAssignees', N'U') IS NULL
CREATE TABLE dbo.RecurringWorkAssignees (
    RecurringId  INT NOT NULL CONSTRAINT FK_RecurringWorkAssignees_Recurring REFERENCES dbo.RecurringWork (RecurringId),
    EmployeeId   INT NOT NULL CONSTRAINT FK_RecurringWorkAssignees_Employees REFERENCES dbo.Employees (EmployeeId),
    CONSTRAINT PK_RecurringWorkAssignees PRIMARY KEY (RecurringId, EmployeeId)
);
GO

/* Work created from a repeating template remembers it */
IF COL_LENGTH(N'dbo.WorkItems', N'RecurringId') IS NULL
    ALTER TABLE dbo.WorkItems ADD RecurringId INT NULL CONSTRAINT FK_WorkItems_Recurring REFERENCES dbo.RecurringWork (RecurringId);
GO

/* ---------- In-app notifications ---------- */
IF OBJECT_ID(N'dbo.Notifications', N'U') IS NULL
CREATE TABLE dbo.Notifications (
    NotificationId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Notifications PRIMARY KEY,
    UserId          INT           NOT NULL CONSTRAINT FK_Notifications_Users REFERENCES dbo.Users (UserId),
    Kind            NVARCHAR(20)  NOT NULL CONSTRAINT CK_Notifications_Kind
                                  CHECK (Kind IN (N'Assigned', N'Status', N'Note', N'Mention', N'Attachment', N'DueToday', N'Overdue', N'Created')),
    WorkId          INT           NULL CONSTRAINT FK_Notifications_WorkItems REFERENCES dbo.WorkItems (WorkId),
    ActorUserId     INT           NULL CONSTRAINT FK_Notifications_Actor REFERENCES dbo.Users (UserId),
    Message         NVARCHAR(400) NOT NULL,
    CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_Notifications_CreatedAt DEFAULT (SYSUTCDATETIME()),
    ReadAt          DATETIME2(0)  NULL
);
GO
