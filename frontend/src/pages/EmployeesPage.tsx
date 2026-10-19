import { Group, Text } from '@mantine/core';
import { PersonAvatar } from '../components/common';
import { MasterPage, type FormValues } from '../components/MasterPage';
import { useAuth } from '../hooks/useAuth';
import type { Employee } from '../types';
import { formatDate } from '../utils/format';

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v.trim() : '');

export function EmployeesPage() {
  const { hasRole } = useAuth();
  return (
    <MasterPage<Employee>
      title="Employees"
      subtitle="Everyone who can be assigned work."
      entityName="employee"
      endpoint="/employees"
      getId={(e) => e.employeeId}
      getLabel={(e) => `${e.employeeCode} – ${e.employeeName}`}
      canEdit={hasRole('Admin')}
      columns={[
        {
          header: 'Name',
          render: (e) => (
            <Group gap={10} wrap="nowrap">
              <PersonAvatar name={e.employeeName} size={30} />
              <Text fw={500}>{e.employeeName}</Text>
            </Group>
          ),
        },
        { header: 'Code', render: (e) => <span className="wd-mono">{e.employeeCode}</span> },
        { header: 'Department', render: (e) => e.department ?? '—' },
        { header: 'Phone', render: (e) => e.phone ?? '—', className: 'hide-sm' },
        { header: 'Email', render: (e) => e.email ?? '—', className: 'hide-sm' },
        { header: 'Joining date', render: (e) => formatDate(e.joiningDate), className: 'hide-md' },
      ]}
      fields={[
        { name: 'employeeCode', label: 'Employee code', required: true, maxLength: 20, upper: true },
        { name: 'employeeName', label: 'Employee name', required: true, maxLength: 100 },
        { name: 'department', label: 'Department', maxLength: 100 },
        { name: 'joiningDate', label: 'Joining date', type: 'date' },
        { name: 'phone', label: 'Phone', type: 'tel', maxLength: 30 },
        { name: 'email', label: 'Email', type: 'email', maxLength: 150 },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      emptyForm={{ employeeCode: '', employeeName: '', department: '', joiningDate: '', phone: '', email: '', isActive: true }}
      toForm={(e): FormValues => ({
        employeeCode: e.employeeCode,
        employeeName: e.employeeName,
        department: e.department ?? '',
        joiningDate: e.joiningDate ?? '',
        phone: e.phone ?? '',
        email: e.email ?? '',
        isActive: e.isActive,
      })}
      toPayload={(f) => ({
        employeeCode: str(f.employeeCode),
        employeeName: str(f.employeeName),
        department: str(f.department) || null,
        joiningDate: str(f.joiningDate) || null,
        phone: str(f.phone) || null,
        email: str(f.email) || null,
        isActive: Boolean(f.isActive),
      })}
    />
  );
}
