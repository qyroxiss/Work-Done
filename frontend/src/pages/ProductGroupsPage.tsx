import { Text } from '@mantine/core';
import { MasterPage } from '../components/MasterPage';
import type { ProductGroup } from '../types';

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v.trim() : '');

export function ProductGroupsPage() {
  return (
    <MasterPage<ProductGroup>
      title="Product Groups"
      subtitle="Categories that products belong to."
      entityName="product group"
      endpoint="/product-groups"
      getId={(g) => g.productGroupId}
      getLabel={(g) => `${g.groupCode} – ${g.groupName}`}
      canEdit
      columns={[
        { header: 'Group name', render: (g) => <Text fw={500}>{g.groupName}</Text> },
        { header: 'Code', render: (g) => <span className="wd-mono">{g.groupCode}</span> },
        { header: 'Description', render: (g) => g.description ?? '—', className: 'hide-sm' },
        { header: 'Products', render: (g) => g.productCount, className: 'num' },
      ]}
      fields={[
        { name: 'groupCode', label: 'Group code', required: true, maxLength: 20, upper: true },
        { name: 'groupName', label: 'Group name', required: true, maxLength: 100 },
        { name: 'description', label: 'Description', type: 'textarea', maxLength: 500 },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      emptyForm={{ groupCode: '', groupName: '', description: '', isActive: true }}
      toForm={(g) => ({
        groupCode: g.groupCode,
        groupName: g.groupName,
        description: g.description ?? '',
        isActive: g.isActive,
      })}
      toPayload={(f) => ({
        groupCode: str(f.groupCode),
        groupName: str(f.groupName),
        description: str(f.description) || null,
        isActive: Boolean(f.isActive),
      })}
    />
  );
}
