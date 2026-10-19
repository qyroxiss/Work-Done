import { useMemo, useState } from 'react';
import { Select, Text } from '@mantine/core';
import { MasterPage } from '../components/MasterPage';
import { useLookups } from '../hooks/useLookups';
import type { Product } from '../types';

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v.trim() : '');

export function ProductsPage() {
  // Include inactive groups so existing products in an inactive group still display/edit correctly
  const { groups } = useLookups({ includeInactive: true });
  const [groupFilter, setGroupFilter] = useState('');

  const groupOptions = useMemo(
    () =>
      groups.map((g) => ({
        value: String(g.productGroupId),
        label: `${g.groupName} (${g.groupCode})${g.isActive ? '' : ' – inactive'}`,
      })),
    [groups],
  );

  return (
    <MasterPage<Product>
      title="Products"
      subtitle="What your office works on, by group."
      entityName="product"
      endpoint="/products"
      getId={(p) => p.productId}
      getLabel={(p) => `${p.productCode} – ${p.productName}`}
      canEdit
      extraQuery={{ productGroupId: groupFilter || undefined }}
      extraFilters={
        <Select
          className="wd-chip"
          data-active={groupFilter !== ''}
          radius="xl"
          w={200}
          aria-label="Product group"
          placeholder="Product group"
          searchable
          clearable
          data={groupOptions}
          value={groupFilter || null}
          onChange={(v) => setGroupFilter(v ?? '')}
        />
      }
      columns={[
        { header: 'Product name', render: (p) => <Text fw={500}>{p.productName}</Text> },
        { header: 'Code', render: (p) => <span className="wd-mono">{p.productCode}</span> },
        { header: 'Group', render: (p) => p.groupName },
        { header: 'Description', render: (p) => p.description ?? '—', className: 'hide-sm' },
      ]}
      fields={[
        { name: 'productCode', label: 'Product code', required: true, maxLength: 20, upper: true },
        { name: 'productName', label: 'Product name', required: true, maxLength: 150 },
        { name: 'productGroupId', label: 'Product group', type: 'select', required: true, options: groupOptions, full: true },
        { name: 'description', label: 'Description', type: 'textarea', maxLength: 500 },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      emptyForm={{ productCode: '', productName: '', productGroupId: '', description: '', isActive: true }}
      toForm={(p) => ({
        productCode: p.productCode,
        productName: p.productName,
        productGroupId: String(p.productGroupId),
        description: p.description ?? '',
        isActive: p.isActive,
      })}
      toPayload={(f) => ({
        productCode: str(f.productCode),
        productName: str(f.productName),
        productGroupId: Number(f.productGroupId),
        description: str(f.description) || null,
        isActive: Boolean(f.isActive),
      })}
    />
  );
}
