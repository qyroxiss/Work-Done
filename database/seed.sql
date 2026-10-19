/*
  WorkDone Management System - DEVELOPMENT seed data
  Master data only. No user accounts are created here: create the first
  administrator with `npm run create-admin` in the backend folder.
  Do NOT run this against a production database.
*/
SET NOCOUNT ON;
GO

MERGE dbo.Employees AS t
USING (VALUES
    (N'EMP001', N'Amit Sharma',   N'Development', N'9800000001', N'amit@example.local',   '2022-04-01'),
    (N'EMP002', N'Priya Verma',   N'Development', N'9800000002', N'priya@example.local',  '2023-01-16'),
    (N'EMP003', N'Rahul Gupta',   N'Support',     N'9800000003', N'rahul@example.local',  '2021-07-12'),
    (N'EMP004', N'Neha Singh',    N'Testing',     N'9800000004', N'neha@example.local',   '2024-02-05'),
    (N'EMP005', N'Vikas Kumar',   N'Support',     N'9800000005', N'vikas@example.local',  '2020-11-23')
) AS s (EmployeeCode, EmployeeName, Department, Phone, Email, JoiningDate)
ON t.EmployeeCode = s.EmployeeCode
WHEN NOT MATCHED THEN
    INSERT (EmployeeCode, EmployeeName, Department, Phone, Email, JoiningDate)
    VALUES (s.EmployeeCode, s.EmployeeName, s.Department, s.Phone, s.Email, s.JoiningDate);
GO

MERGE dbo.ProductGroups AS t
USING (VALUES
    (N'ACC', N'Accounting Software', N'Accounting and billing products'),
    (N'INV', N'Inventory',           N'Stock and warehouse products'),
    (N'HR',  N'HR & Payroll',        N'Human resources and payroll products'),
    (N'WEB', N'Web Services',        N'Websites and hosted services')
) AS s (GroupCode, GroupName, Description)
ON t.GroupCode = s.GroupCode
WHEN NOT MATCHED THEN
    INSERT (GroupCode, GroupName, Description) VALUES (s.GroupCode, s.GroupName, s.Description);
GO

MERGE dbo.Products AS t
USING (
    SELECT s.ProductCode, s.ProductName, g.ProductGroupId, s.Description
    FROM (VALUES
        (N'ACC-BILL', N'Billing Pro',         N'ACC', N'GST billing application'),
        (N'ACC-LEDG', N'Ledger Manager',      N'ACC', N'Accounts ledger'),
        (N'INV-STK',  N'Stock Tracker',       N'INV', N'Inventory management'),
        (N'INV-WMS',  N'Warehouse Manager',   N'INV', N'Multi-location warehouse'),
        (N'HR-PAY',   N'Payroll Plus',        N'HR',  N'Payroll processing'),
        (N'HR-ATT',   N'Attendance System',   N'HR',  N'Biometric attendance'),
        (N'WEB-SITE', N'Company Website',     N'WEB', N'Corporate websites'),
        (N'WEB-HOST', N'Hosting & Domains',   N'WEB', N'Hosting support')
    ) AS s (ProductCode, ProductName, GroupCode, Description)
    JOIN dbo.ProductGroups g ON g.GroupCode = s.GroupCode
) AS s
ON t.ProductCode = s.ProductCode
WHEN NOT MATCHED THEN
    INSERT (ProductCode, ProductName, ProductGroupId, Description)
    VALUES (s.ProductCode, s.ProductName, s.ProductGroupId, s.Description);
GO
