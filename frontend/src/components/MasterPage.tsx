import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Box, Button, Checkbox, Group, Menu, ActionIcon, SegmentedControl, Select, SimpleGrid, Stack, Table, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { MoreHorizontal, Pencil, Plus, Power, Search } from 'lucide-react';
import { useConfirm } from '../hooks/useConfirm';
import { useDebounce } from '../hooks/useDebounce';
import { useToast } from '../hooks/useToast';
import { api, ApiError, errorMessage, qs } from '../services/api';
import type { Paged } from '../types';
import { parseDateInput, toDateInput } from '../utils/format';
import { ActiveBadge, Bezel, EmptyState, ErrorBanner, PageHeader, Pagination, Spinner } from './common';
import { Modal } from './Modal';

export type FormValues = Record<string, string | boolean>;

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'textarea' | 'select' | 'checkbox' | 'password';
  required?: boolean;
  maxLength?: number;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  full?: boolean;
  /** Shown only when creating a new record */
  createOnly?: boolean;
  /** Upper-case the value while typing (codes) */
  upper?: boolean;
}

export interface ColumnDef<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface MasterPageProps<T> {
  title: string;
  subtitle?: string;
  entityName: string;
  endpoint: string;
  getId: (row: T) => number;
  getLabel: (row: T) => string;
  columns: ColumnDef<T>[];
  fields: FieldDef[];
  emptyForm: FormValues;
  toForm: (row: T) => FormValues;
  toPayload: (form: FormValues, editing: T | null) => unknown;
  canEdit: boolean;
  /** Extra per-row menu items (e.g. reset password) */
  rowActions?: (row: T, reload: () => void) => ReactNode;
  /** Extra query string parameters & filter controls */
  extraQuery?: Record<string, string | number | undefined>;
  extraFilters?: ReactNode;
}

/**
 * Generic list + create/edit page for master data (employees, products, users...).
 * Records are never deleted: they are deactivated so historical work keeps its references.
 */
export function MasterPage<T extends { isActive: boolean }>(props: MasterPageProps<T>) {
  const { endpoint, entityName, canEdit } = props;
  const toast = useToast();
  const confirm = useConfirm();

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('true');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Paged<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormValues>(props.emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const debouncedSearch = useDebounce(search);
  const extraKey = JSON.stringify(props.extraQuery ?? {});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const query = qs({
        search: debouncedSearch,
        isActive: activeFilter === 'all' ? undefined : activeFilter,
        page,
        pageSize,
        ...JSON.parse(extraKey),
      });
      setData(await api.get<Paged<T>>(`${endpoint}${query}`));
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [endpoint, debouncedSearch, activeFilter, page, pageSize, extraKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setPage(1), [debouncedSearch, activeFilter, extraKey]);

  const openCreate = () => {
    setEditing(null);
    setForm(props.emptyForm);
    setErrors({});
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (row: T) => {
    setEditing(row);
    setForm(props.toForm(row));
    setErrors({});
    setFormError(null);
    setFormOpen(true);
  };

  const visibleFields = props.fields.filter((f) => !f.createOnly || !editing);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    for (const f of visibleFields) {
      const v = form[f.name];
      if (f.required && f.type !== 'checkbox' && (typeof v !== 'string' || v.trim() === '')) {
        errs[f.name] = `${f.label} is required`;
      } else if (f.type === 'email' && typeof v === 'string' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        errs[f.name] = 'Invalid email address';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = props.toPayload(form, editing);
      if (editing) {
        await api.put(`${endpoint}/${props.getId(editing)}`, payload);
        toast.success(`${capitalize(entityName)} updated`);
      } else {
        await api.post(endpoint, payload);
        toast.success(`${capitalize(entityName)} created`);
      }
      setFormOpen(false);
      void load();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: T) => {
    const activating = !row.isActive;
    const ok = await confirm({
      title: `${activating ? 'Activate' : 'Deactivate'} ${entityName}`,
      message: activating
        ? `Activate "${props.getLabel(row)}"?`
        : `Deactivate "${props.getLabel(row)}"? It will no longer be available for new work, but existing records keep their history.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
      danger: !activating,
    });
    if (!ok) return;
    try {
      const payload = props.toPayload({ ...props.toForm(row), isActive: activating }, row);
      await api.put(`${endpoint}/${props.getId(row)}`, payload);
      toast.success(`${capitalize(entityName)} ${activating ? 'activated' : 'deactivated'}`);
      void load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const setValue = (f: FieldDef, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [f.name]: typeof value === 'string' && f.upper ? value.toUpperCase() : value }));
  };

  const hasActions = canEdit || Boolean(props.rowActions);

  return (
    <Stack gap={24}>
      <PageHeader
        title={props.title}
        count={data?.total}
        subtitle={props.subtitle}
        actions={
          canEdit && (
            <Button className="wd-ink" leftSection={<Plus size={16} />} onClick={openCreate}>
              New {entityName}
            </Button>
          )
        }
      />

      <Group gap={8} wrap="wrap">
        <TextInput
          type="search"
          aria-label={`Search ${entityName}s`}
          placeholder={`Search ${entityName}s…`}
          leftSection={<Search size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: '1 1 260px' }}
        />
        {props.extraFilters}
        <SegmentedControl
          aria-label="Show"
          value={activeFilter}
          onChange={(v) => setActiveFilter(v as typeof activeFilter)}
          data={[
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
            { value: 'all', label: 'All' },
          ]}
        />
      </Group>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      <Bezel
        footer={
          data && data.total > 0 ? (
            <Box mx={-12} my={-6}>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={data.total}
                onPage={setPage}
                onPageSize={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
              />
            </Box>
          ) : undefined
        }
      >
        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length === 0 ? (
          <EmptyState title={`No ${entityName}s found`}>
            {search ? 'Try a different search.' : canEdit ? `Use "New ${entityName}" to add one.` : null}
          </EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={720} className={loading ? 'table-loading' : undefined}>
            <Table verticalSpacing={14} horizontalSpacing="sm" className="wd-table">
              <Table.Thead>
                <Table.Tr>
                  {props.columns.map((c) => (
                    <Table.Th key={c.header} className={c.className}>
                      {c.header}
                    </Table.Th>
                  ))}
                  <Table.Th>Status</Table.Th>
                  {hasActions && <Table.Th w={56} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.items.map((row) => (
                  <Table.Tr key={props.getId(row)} style={row.isActive ? undefined : { opacity: 0.55 }}>
                    {props.columns.map((c) => (
                      <Table.Td key={c.header} className={c.className}>
                        {c.render(row)}
                      </Table.Td>
                    ))}
                    <Table.Td>
                      <ActiveBadge active={row.isActive} />
                    </Table.Td>
                    {hasActions && (
                      <Table.Td ta="right">
                        <Menu position="bottom-end" withinPortal shadow="md" radius="lg" width={200}>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" radius="xl" aria-label={`Actions for ${props.getLabel(row)}`}>
                              <MoreHorizontal size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {canEdit && (
                              <>
                                <Menu.Item leftSection={<Pencil size={15} />} onClick={() => openEdit(row)}>
                                  Edit
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={<Power size={15} />}
                                  color={row.isActive ? 'red' : undefined}
                                  onClick={() => toggleActive(row)}
                                >
                                  {row.isActive ? 'Deactivate' : 'Activate'}
                                </Menu.Item>
                              </>
                            )}
                            {props.rowActions?.(row, load)}
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Bezel>

      {formOpen && (
        <Modal
          title={editing ? `Edit ${entityName}` : `New ${entityName}`}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button className="wd-soft" onClick={() => setFormOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button className="wd-ink" type="submit" form="master-form" loading={saving}>
                Save
              </Button>
            </>
          }
        >
          <form id="master-form" onSubmit={save} noValidate>
            {formError && (
              <Alert color="red" variant="light" radius="lg" mb="md">
                {formError}
              </Alert>
            )}
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">
              {visibleFields.map((f) => (
                <Box key={f.name} style={f.full || f.type === 'textarea' || f.type === 'checkbox' ? { gridColumn: '1 / -1' } : undefined}>
                  <FieldInput field={f} value={form[f.name]} error={errors[f.name]} onChange={(v) => setValue(f, v)} />
                </Box>
              ))}
            </SimpleGrid>
          </form>
        </Modal>
      )}
    </Stack>
  );
}

function FieldInput({
  field: f,
  value,
  error,
  onChange,
}: {
  field: FieldDef;
  value: string | boolean | undefined;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  if (f.type === 'checkbox') {
    return <Checkbox label={f.label} checked={Boolean(value)} onChange={(e) => onChange(e.currentTarget.checked)} />;
  }
  const str = typeof value === 'string' ? value : '';
  const common = { label: f.label, required: f.required, error, description: error ? undefined : f.hint };
  if (f.type === 'textarea') {
    return <Textarea {...common} autosize minRows={3} maxLength={f.maxLength} value={str} onChange={(e) => onChange(e.currentTarget.value)} />;
  }
  if (f.type === 'select') {
    return (
      <Select
        {...common}
        searchable
        placeholder={f.placeholder ?? 'Select…'}
        data={f.options ?? []}
        value={str || null}
        onChange={(v) => onChange(v ?? '')}
        comboboxProps={{ withinPortal: true }}
      />
    );
  }
  if (f.type === 'date') {
    return (
      <DatePickerInput
        {...common}
        clearable
        valueFormat="D MMM YYYY"
        placeholder="Pick a date"
        value={parseDateInput(str)}
        onChange={(d) => onChange(d ? toDateInput(d) : '')}
      />
    );
  }
  return (
    <TextInput
      {...common}
      type={f.type === 'password' ? 'password' : (f.type ?? 'text')}
      maxLength={f.maxLength}
      placeholder={f.placeholder}
      value={str}
      autoComplete={f.type === 'password' ? 'new-password' : 'off'}
      classNames={f.upper ? { input: 'wd-mono' } : undefined}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
