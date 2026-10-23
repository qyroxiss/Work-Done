/*
  Q-WorkDone - DEVELOPMENT sample data for one company ("dbo." = its schema).
  Master data only; no user accounts. Do NOT load this into a real company.
*/
INSERT INTO dbo.Employees (EmployeeCode, EmployeeName, Department, Phone, Email, JoiningDate) VALUES
    ('EMP001', 'Amit Sharma', 'Development', '9800000001', 'amit@example.local',  '2022-04-01'),
    ('EMP002', 'Priya Verma', 'Development', '9800000002', 'priya@example.local', '2023-01-16'),
    ('EMP003', 'Rahul Gupta', 'Support',     '9800000003', 'rahul@example.local', '2021-07-12'),
    ('EMP004', 'Neha Singh',  'Testing',     '9800000004', 'neha@example.local',  '2024-02-05'),
    ('EMP005', 'Vikas Kumar', 'Support',     '9800000005', 'vikas@example.local', '2020-11-23')
ON CONFLICT (EmployeeCode) DO NOTHING;

INSERT INTO dbo.ProductGroups (GroupCode, GroupName, Description) VALUES
    ('ACC', 'Accounting Software', 'Accounting and billing products'),
    ('INV', 'Inventory',           'Stock and warehouse products'),
    ('HR',  'HR & Payroll',        'Human resources and payroll products'),
    ('WEB', 'Web Services',        'Websites and hosted services')
ON CONFLICT (GroupCode) DO NOTHING;

INSERT INTO dbo.Products (ProductCode, ProductName, ProductGroupId, Description)
SELECT s.ProductCode, s.ProductName, g.ProductGroupId, s.Description
FROM (VALUES
    ('ACC-BILL', 'Billing Pro',       'ACC', 'GST billing application'),
    ('ACC-LEDG', 'Ledger Manager',    'ACC', 'Accounts ledger'),
    ('INV-STK',  'Stock Tracker',     'INV', 'Inventory management'),
    ('INV-WMS',  'Warehouse Manager', 'INV', 'Multi-location warehouse'),
    ('HR-PAY',   'Payroll Plus',      'HR',  'Payroll processing'),
    ('HR-ATT',   'Attendance System', 'HR',  'Biometric attendance'),
    ('WEB-SITE', 'Company Website',   'WEB', 'Corporate websites'),
    ('WEB-HOST', 'Hosting & Domains', 'WEB', 'Hosting support')
) AS s (ProductCode, ProductName, GroupCode, Description)
JOIN dbo.ProductGroups g ON g.GroupCode = s.GroupCode
ON CONFLICT (ProductCode) DO NOTHING;
