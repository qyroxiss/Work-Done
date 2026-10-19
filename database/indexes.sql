/*
  WorkDone Management System - indexes
  Run after schema.sql. Idempotent.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

/* Prevent duplicate ACTIVE assignments of the same employee to the same work item */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_WorkAssignments_Active' AND object_id = OBJECT_ID(N'dbo.WorkAssignments'))
    CREATE UNIQUE INDEX UX_WorkAssignments_Active ON dbo.WorkAssignments (WorkId, EmployeeId) WHERE IsActive = 1;
GO

/* One login per employee */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Users_EmployeeId' AND object_id = OBJECT_ID(N'dbo.Users'))
    CREATE UNIQUE INDEX UX_Users_EmployeeId ON dbo.Users (EmployeeId) WHERE EmployeeId IS NOT NULL;
GO

/* Email login: each email belongs to at most one user */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Users_Email' AND object_id = OBJECT_ID(N'dbo.Users'))
    CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users (Email) WHERE Email IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_WorkItems_WorkNo' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE UNIQUE INDEX UX_WorkItems_WorkNo ON dbo.WorkItems (WorkNo);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkAssignments_Employee' AND object_id = OBJECT_ID(N'dbo.WorkAssignments'))
    CREATE INDEX IX_WorkAssignments_Employee ON dbo.WorkAssignments (EmployeeId, IsActive) INCLUDE (WorkId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkItems_Status_DueDate' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE INDEX IX_WorkItems_Status_DueDate ON dbo.WorkItems (Status, DueDate);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkItems_DueDate' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE INDEX IX_WorkItems_DueDate ON dbo.WorkItems (DueDate);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkItems_CreatedAt' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE INDEX IX_WorkItems_CreatedAt ON dbo.WorkItems (CreatedAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkItems_UpdatedAt' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE INDEX IX_WorkItems_UpdatedAt ON dbo.WorkItems (UpdatedAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkItems_Product' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE INDEX IX_WorkItems_Product ON dbo.WorkItems (ProductId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkItems_ProductGroup' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE INDEX IX_WorkItems_ProductGroup ON dbo.WorkItems (ProductGroupId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkStatusHistory_Work' AND object_id = OBJECT_ID(N'dbo.WorkStatusHistory'))
    CREATE INDEX IX_WorkStatusHistory_Work ON dbo.WorkStatusHistory (WorkId, ChangedAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkStatusHistory_ChangedAt' AND object_id = OBJECT_ID(N'dbo.WorkStatusHistory'))
    CREATE INDEX IX_WorkStatusHistory_ChangedAt ON dbo.WorkStatusHistory (ChangedAt) INCLUDE (WorkId, EntryType, NewStatus);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Products_Group' AND object_id = OBJECT_ID(N'dbo.Products'))
    CREATE INDEX IX_Products_Group ON dbo.Products (ProductGroupId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Sessions_User' AND object_id = OBJECT_ID(N'dbo.Sessions'))
    CREATE INDEX IX_Sessions_User ON dbo.Sessions (UserId) INCLUDE (RevokedAt, ExpiresAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SecurityEvents_CreatedAt' AND object_id = OBJECT_ID(N'dbo.SecurityEvents'))
    CREATE INDEX IX_SecurityEvents_CreatedAt ON dbo.SecurityEvents (CreatedAt);
GO

/* Chat */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ChatConversations_DirectKey' AND object_id = OBJECT_ID(N'dbo.ChatConversations'))
    CREATE UNIQUE INDEX UX_ChatConversations_DirectKey ON dbo.ChatConversations (DirectKey) WHERE DirectKey IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChatMessages_Conversation' AND object_id = OBJECT_ID(N'dbo.ChatMessages'))
    CREATE INDEX IX_ChatMessages_Conversation ON dbo.ChatMessages (ConversationId, MessageId) INCLUDE (SenderUserId, CreatedAt);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChatMembers_User' AND object_id = OBJECT_ID(N'dbo.ChatMembers'))
    CREATE INDEX IX_ChatMembers_User ON dbo.ChatMembers (UserId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ChatAttachments_Message' AND object_id = OBJECT_ID(N'dbo.ChatAttachments'))
    CREATE UNIQUE INDEX UX_ChatAttachments_Message ON dbo.ChatAttachments (MessageId);
GO

/* Work files, notifications, repeating work */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkAttachments_Work' AND object_id = OBJECT_ID(N'dbo.WorkAttachments'))
    CREATE INDEX IX_WorkAttachments_Work ON dbo.WorkAttachments (WorkId) INCLUDE (FileName, SizeBytes, DeletedAt);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Notifications_User' AND object_id = OBJECT_ID(N'dbo.Notifications'))
    CREATE INDEX IX_Notifications_User ON dbo.Notifications (UserId, NotificationId DESC) INCLUDE (ReadAt);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Notifications_Work' AND object_id = OBJECT_ID(N'dbo.Notifications'))
    CREATE INDEX IX_Notifications_Work ON dbo.Notifications (WorkId, Kind, UserId) INCLUDE (CreatedAt);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_RecurringWork_Next' AND object_id = OBJECT_ID(N'dbo.RecurringWork'))
    CREATE INDEX IX_RecurringWork_Next ON dbo.RecurringWork (IsActive, NextDueDate);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkItems_Recurring' AND object_id = OBJECT_ID(N'dbo.WorkItems'))
    CREATE INDEX IX_WorkItems_Recurring ON dbo.WorkItems (RecurringId) WHERE RecurringId IS NOT NULL;
GO
