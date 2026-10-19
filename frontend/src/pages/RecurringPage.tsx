import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { MoreHorizontal, Pause, Pencil, Play, Plus, Repeat, Search } from 'lucide-react';
import { Bezel, EmptyState, ErrorBanner, PageHeader, Pagination, PersonAvatar, PriorityMark, Spinner } from '../components/common';
import { Modal } from '../components/Modal';
import { useDebounce } from '../hooks/useDebounce';
import { useLookups } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { api, ApiError, errorMessage, qs } from '../services/api';
import { FREQUENCIES, PRIORITIES, type Frequency, type Paged, type Priority, type RecurringTemplate } from '../types';
import { formatDate, parseDateInput, relativeTime, toDateInput, todayInput } from '../utils/format';

const EVERY: Record<Frequency, string> = { Weekly: 'Every week', Monthly: 'Every month', Quarterly: 'Every quarter', Yearly: 'Every year' };
const dot = (color: string) => ({ '--dot': color }) as CSSProperties;

function dayLabel(day: string) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(parseDateInput(day)!);
}

function schedule(t: Pick<RecurringTemplate, 'frequency' | 'nextDueDate'>) {
  const d = parseDateInput(t.nextDueDate)!;
  if (t.frequency === 'Weekly') return `Every ${new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(d)}`;
  const day = d.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${EVERY[t.frequency]} on the ${day}${suffix}`;
}

interface FormState {
  title: string;
  description: string;
  productGroupId: string;
  productId: string;
  priority: Priority;
  frequency: Frequency;
  nextDueDate: string;
  leadDays: number;
  endDate: string;
  employeeIds: string[];
  isActive: boolean;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  productGroupId: '',
  productId: '',
  priority: 'Medium',
  frequency: 'Monthly',
  nextDueDate: '',
  leadDays: 7,
  endDate: '',
  employeeIds: [],
  isActive: true,
};

export function RecurringPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'true' | 'false' | 'all'>('true');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<RecurringTemplate> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecurringTemplate | 'new' | null>(null);
  const debounced = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Paged<RecurringTemplate>>(`/recurring-work${qs({ search: debounced, isActive: show === 'all' ? undefined : show, page, pageSize: 25 })}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debounced, show, page]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setPage(1), [debounced, show]);

  const toggle = async (t: RecurringTemplate) => {
    try {
      await api.put(`/recurring-work/${t.recurringId}`, { ...toPayload(toForm(t)), isActive: !t.isActive });
      toast.success(t.isActive ? 'Paused. No new work will be created.' : 'Resumed');
      void load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Stack gap={24}>
      <PageHeader
        eyebrow="Work"
        title="Repeating work"
        count={data?.total}
        subtitle="Returns, payroll and other work that comes round every week, month, quarter or year. Each one is created automatically before it is due."
        actions={
          <Button className="wd-ink" leftSection={<Plus size={16} />} onClick={() => setEditing('new')}>
            New repeating work
          </Button>
        }
      />

      <Group gap={8} wrap="wrap">
        <TextInput
          type="search"
          aria-label="Search repeating work"
          placeholder="Search…"
          leftSection={<Search size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: '1 1 260px' }}
        />
        <SegmentedControl
          aria-label="Show"
          value={show}
          onChange={(v) => setShow(v as typeof show)}
          data={[
            { value: 'true', label: 'Running' },
            { value: 'false', label: 'Paused' },
            { value: 'all', label: 'All' },
          ]}
        />
      </Group>

      {error && <ErrorBanner message={error} onRetry={load} />}

      <Bezel
        footer={
          data && data.total > 25 ? (
            <Box mx={-12} my={-6}>
              <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
            </Box>
          ) : undefined
        }
      >
        {loading && !data ? (
          <Spinner />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No repeating work yet">
            {search ? 'Try a different search.' : 'Set up monthly returns or weekly checks once, and they appear in Work on time.'}
          </EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={860} className={loading ? 'table-loading' : undefined}>
            <Table verticalSpacing={14} horizontalSpacing="sm" className="wd-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Work</Table.Th>
                  <Table.Th>Next due</Table.Th>
                  <Table.Th>People</Table.Th>
                  <Table.Th>Priority</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th w={56} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.items.map((t) => (
                  <Table.Tr key={t.recurringId} style={t.isActive && !t.ended ? undefined : { opacity: 0.6 }} onClick={() => setEditing(t)}>
                    <Table.Td maw={360}>
                      <Text fw={500} fz={15} truncate>
                        {t.title}
                      </Text>
                      <Group gap={6} mt={3} wrap="nowrap">
                        <Repeat size={12} color="var(--wd-muted)" />
                        <Text size="xs" c="dimmed" truncate>
                          {schedule(t)}
                          {t.productName ? ` · ${t.productName}` : t.groupName ? ` · ${t.groupName}` : ''}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {t.ended ? (
                        <Text c="dimmed">Ended {formatDate(t.endDate)}</Text>
                      ) : (
                        <Tooltip label={`Then ${t.upcoming.slice(1).map(dayLabel).join(', ') || '—'}`} withArrow disabled={t.upcoming.length < 2}>
                          <div>
                            <Text fw={500}>{formatDate(t.nextDueDate)}</Text>
                            <Text size="xs" c="dimmed">
                              {t.nextCreateDate && t.nextCreateDate <= todayInput() ? 'Created today' : `Appears ${dayLabel(t.nextCreateDate!)}`}
                            </Text>
                          </div>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {t.assignees.length === 0 ? (
                        <Text c="dimmed">Unassigned</Text>
                      ) : (
                        <Tooltip label={t.assignees.map((a) => a.employeeName).join(', ')} withArrow>
                          <span className="wd-avatar-stack" style={{ display: 'inline-flex' }}>
                            {t.assignees.slice(0, 4).map((a) => (
                              <PersonAvatar key={a.employeeId} name={a.employeeName} size={28} />
                            ))}
                          </span>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <PriorityMark priority={t.priority} />
                    </Table.Td>
                    <Table.Td>
                      <span className="wd-status">
                        <span className="wd-dot" style={dot(t.ended ? '#9B9A96' : t.isActive ? '#12A150' : '#F59E0B')} />
                        {t.ended ? 'Ended' : t.isActive ? 'Running' : 'Paused'}
                      </span>
                      <Text size="xs" c="dimmed" mt={3}>
                        {t.createdCount} created{t.lastCreatedAt ? ` · last ${relativeTime(t.lastCreatedAt)}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" onClick={(e) => e.stopPropagation()}>
                      <Menu position="bottom-end" radius="lg" shadow="md" width={180}>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" radius="xl" aria-label={`Actions for ${t.title}`}>
                            <MoreHorizontal size={18} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<Pencil size={15} />} onClick={() => setEditing(t)}>
                            Edit
                          </Menu.Item>
                          <Menu.Item leftSection={t.isActive ? <Pause size={15} /> : <Play size={15} />} onClick={() => void toggle(t)}>
                            {t.isActive ? 'Pause' : 'Resume'}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Bezel>

      {editing && (
        <RecurringForm
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            toast.success(created ? `Saved. ${created} work item${created > 1 ? 's were' : ' was'} created now.` : 'Saved');
            void load();
          }}
        />
      )}
    </Stack>
  );
}

function toForm(t: RecurringTemplate): FormState {
  return {
    title: t.title,
    description: t.description ?? '',
    productGroupId: t.productGroupId ? String(t.productGroupId) : '',
    productId: t.productId ? String(t.productId) : '',
    priority: t.priority,
    frequency: t.frequency,
    nextDueDate: t.nextDueDate,
    leadDays: t.leadDays,
    endDate: t.endDate ?? '',
    employeeIds: t.assignees.map((a) => String(a.employeeId)),
    isActive: t.isActive,
  };
}

function toPayload(f: FormState) {
  return {
    title: f.title.trim(),
    description: f.description.trim() || null,
    productGroupId: f.productGroupId ? Number(f.productGroupId) : null,
    productId: f.productId ? Number(f.productId) : null,
    priority: f.priority,
    frequency: f.frequency,
    nextDueDate: f.nextDueDate,
    leadDays: f.leadDays,
    endDate: f.endDate || null,
    employeeIds: f.employeeIds.map(Number),
    isActive: f.isActive,
  };
}

function RecurringForm({ template, onClose, onSaved }: { template: RecurringTemplate | null; onClose: () => void; onSaved: (created: number) => void }) {
  const { employees, groups, products, loading: lookupsLoading } = useLookups({ employees: true });
  const [form, setForm] = useState<FormState>(template ? toForm(template) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value, ...(key === 'productGroupId' ? { productId: '' } : {}) }));

  const filteredProducts = useMemo(
    () => (form.productGroupId ? products.filter((p) => String(p.productGroupId) === form.productGroupId) : products),
    [products, form.productGroupId],
  );

  const employeeData = useMemo(() => {
    const byDept = new Map<string, { value: string; label: string }[]>();
    for (const e of employees) {
      const dept = e.department || 'Other';
      byDept.set(dept, [...(byDept.get(dept) ?? []), { value: String(e.employeeId), label: e.employeeName }]);
    }
    // Keep people who are on the template but no longer active, so they can be removed
    for (const a of template?.assignees ?? []) {
      if (!employees.some((e) => e.employeeId === a.employeeId)) {
        const label = lookupsLoading ? a.employeeName : `${a.employeeName} (inactive)`;
        byDept.set('Inactive', [...(byDept.get('Inactive') ?? []), { value: String(a.employeeId), label }]);
      }
    }
    return [...byDept.entries()].map(([group, items]) => ({ group, items }));
  }, [employees, template, lookupsLoading]);

  const createOn = form.nextDueDate ? toDateInput(new Date(parseDateInput(form.nextDueDate)!.getTime() - form.leadDays * 86_400_000)) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = 'Title is required';
    if (!form.nextDueDate) errs.nextDueDate = 'Pick the next due date';
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body = toPayload(form);
      const r = template
        ? await api.put<{ created: number }>(`/recurring-work/${template.recurringId}`, body)
        : await api.post<{ created: number }>('/recurring-work', body);
      onSaved(r.created);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={template ? 'Edit repeating work' : 'New repeating work'}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button className="wd-soft" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="wd-ink" type="submit" form="recurring-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="recurring-form" onSubmit={submit} noValidate>
        <Stack gap="md">
          {error && (
            <Alert color="red" variant="light" radius="lg">
              {error}
            </Alert>
          )}
          <TextInput
            label="Title"
            required
            size="md"
            maxLength={200}
            placeholder="GSTR-3B for {prevMonth}"
            description="{month}, {prevMonth} and {date} are filled in for each item, e.g. “GSTR-3B for Sep 2026”."
            value={form.title}
            error={errors.title}
            onChange={(e) => set('title', e.currentTarget.value)}
            data-autofocus
          />
          <Textarea label="Description" autosize minRows={2} maxLength={8000} value={form.description} onChange={(e) => set('description', e.currentTarget.value)} />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Select
              label="Product group"
              placeholder="None"
              searchable
              clearable
              data={groups.map((g) => ({ value: String(g.productGroupId), label: g.groupName }))}
              value={form.productGroupId || null}
              onChange={(v) => set('productGroupId', v ?? '')}
              error={errors.productGroupId}
            />
            <Select
              label="Product"
              placeholder="None"
              searchable
              clearable
              data={filteredProducts.map((p) => ({ value: String(p.productId), label: p.productName }))}
              value={form.productId || null}
              onChange={(v) => set('productId', v ?? '')}
              error={errors.productId}
            />
          </SimpleGrid>
          <div>
            <Text size="sm" fw={500} mb={6}>
              Priority
            </Text>
            <SegmentedControl
              fullWidth
              value={form.priority}
              onChange={(v) => set('priority', v as Priority)}
              data={PRIORITIES.map((p) => ({ value: p, label: <PriorityMark priority={p} /> }))}
            />
          </div>

          <Box p="md" style={{ boxShadow: 'inset 0 0 0 1px var(--wd-line)', borderRadius: 16 }}>
            <Stack gap="md">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Select
                  label="Repeats"
                  allowDeselect={false}
                  data={FREQUENCIES.map((f) => ({ value: f, label: EVERY[f] }))}
                  value={form.frequency}
                  onChange={(v) => v && set('frequency', v as Frequency)}
                />
                <DatePickerInput
                  label="Next due date"
                  required
                  valueFormat="D MMM YYYY"
                  placeholder="Pick a date"
                  minDate={new Date()}
                  value={parseDateInput(form.nextDueDate)}
                  onChange={(d) => set('nextDueDate', d ? toDateInput(d) : '')}
                  error={errors.nextDueDate}
                />
                <NumberInput
                  label="Create it this many days before"
                  min={0}
                  max={90}
                  clampBehavior="strict"
                  value={form.leadDays}
                  onChange={(v) => set('leadDays', typeof v === 'number' ? v : 0)}
                  error={errors.leadDays}
                  description="Also its start date"
                />
                <DatePickerInput
                  label="Stop after (optional)"
                  clearable
                  valueFormat="D MMM YYYY"
                  placeholder="Keeps repeating"
                  value={parseDateInput(form.endDate)}
                  onChange={(d) => set('endDate', d ? toDateInput(d) : '')}
                  error={errors.endDate}
                />
              </SimpleGrid>
              {form.nextDueDate && (
                <Text size="sm">
                  <Repeat size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
                  {schedule({ frequency: form.frequency, nextDueDate: form.nextDueDate })}. The next one appears on{' '}
                  <strong>{formatDate(createOn)}</strong>
                  {createOn && createOn <= todayInput() ? ' (right after you save)' : ''}, due <strong>{formatDate(form.nextDueDate)}</strong>.
                </Text>
              )}
            </Stack>
          </Box>

          <MultiSelect
            label="Assign to"
            placeholder={form.employeeIds.length ? undefined : 'Nobody yet'}
            searchable
            clearable
            data={employeeData}
            value={form.employeeIds}
            onChange={(v) => set('employeeIds', v)}
            error={errors.employeeIds}
            comboboxProps={{ withinPortal: true }}
          />
          <Checkbox label="Running (uncheck to pause)" checked={form.isActive} onChange={(e) => set('isActive', e.currentTarget.checked)} />
        </Stack>
      </form>
    </Modal>
  );
}
