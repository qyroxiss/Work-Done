import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Checkbox, Group, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { AlertCircle, Search } from 'lucide-react';
import { Bezel, ErrorBanner, PageHeader, PersonAvatar, PriorityMark, Spinner } from '../components/common';
import { useLookups } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { api, ApiError, errorMessage } from '../services/api';
import { PRIORITIES, type Employee, type Priority, type WorkDetail } from '../types';
import { parseDateInput, toDateInput } from '../utils/format';

interface FormState {
  title: string;
  description: string;
  productGroupId: string;
  productId: string;
  priority: Priority;
  startDate: string;
  dueDate: string;
  employeeIds: number[];
}

const EMPTY: FormState = {
  title: '',
  description: '',
  productGroupId: '',
  productId: '',
  priority: 'Medium',
  startDate: '',
  dueDate: '',
  employeeIds: [],
};

/** Create a new work item, or edit details and assignees of an existing one. */
export function WorkFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();
  const toast = useToast();
  // Inactive masters are loaded too, so existing work referencing them still displays
  const { employees, groups, products, loading: lookupsLoading } = useLookups({ employees: true, includeInactive: true });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [original, setOriginal] = useState<WorkDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');

  useEffect(() => {
    if (!editId) {
      setOriginal(null);
      setForm(EMPTY);
      return;
    }
    api
      .get<WorkDetail>(`/work-items/${editId}`)
      .then((w) => {
        setOriginal(w);
        setForm({
          title: w.title,
          description: w.description ?? '',
          productGroupId: w.productGroupId ? String(w.productGroupId) : '',
          productId: w.productId ? String(w.productId) : '',
          priority: w.priority,
          startDate: w.startDate ?? '',
          dueDate: w.dueDate ?? '',
          employeeIds: w.assignees.map((a) => a.employeeId),
        });
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [editId]);

  // Selectable = active, or already used by this work item
  const groupOptions = groups.filter((g) => g.isActive || String(g.productGroupId) === form.productGroupId);
  const productOptions = products.filter(
    (p) =>
      (p.isActive || String(p.productId) === form.productId) &&
      (!form.productGroupId || String(p.productGroupId) === form.productGroupId),
  );

  /** Matching employees, grouped by department */
  const departments = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    const matches = employees.filter(
      (e) =>
        (e.isActive || form.employeeIds.includes(e.employeeId)) &&
        (!term ||
          e.employeeName.toLowerCase().includes(term) ||
          e.employeeCode.toLowerCase().includes(term) ||
          (e.department ?? '').toLowerCase().includes(term)),
    );
    const byDept = new Map<string, Employee[]>();
    for (const e of matches) {
      const key = e.department || 'No department';
      byDept.set(key, [...(byDept.get(key) ?? []), e]);
    }
    return [...byDept.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [employees, employeeSearch, form.employeeIds]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onProductChange = (productId: string) => {
    const product = products.find((p) => String(p.productId) === productId);
    setForm((f) => ({ ...f, productId, productGroupId: product ? String(product.productGroupId) : f.productGroupId }));
  };

  const toggleEmployee = (employeeId: number) =>
    setForm((f) => ({
      ...f,
      employeeIds: f.employeeIds.includes(employeeId)
        ? f.employeeIds.filter((x) => x !== employeeId)
        : [...f.employeeIds, employeeId],
    }));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = 'Title is required';
    if (form.startDate && form.dueDate && form.dueDate < form.startDate) errs.dueDate = 'Due date cannot be before the start date';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      productGroupId: form.productGroupId ? Number(form.productGroupId) : null,
      productId: form.productId ? Number(form.productId) : null,
      priority: form.priority,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      employeeIds: form.employeeIds,
    };
    try {
      const saved = original
        ? await api.put<WorkDetail>(`/work-items/${original.workId}`, { ...payload, rowVersion: original.rowVersion })
        : await api.post<WorkDetail>('/work-items', payload);
      toast.success(original ? `${saved.workNo} updated` : `${saved.workNo} created`);
      navigate(`/work?id=${saved.workId}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <ErrorBanner message={loadError} />;
  if ((editId && !original) || lookupsLoading) return <Spinner />;

  const dueDays =
    form.startDate && form.dueDate ? Math.round((parseDateInput(form.dueDate)!.getTime() - parseDateInput(form.startDate)!.getTime()) / 86_400_000) : null;

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap={28}>
        <PageHeader
          eyebrow={
            <Link to="/work" className="wd-eyebrow">
              ← Work
            </Link>
          }
          title={original ? `Edit ${original.workNo}` : 'New work item'}
          period
          subtitle={original ? 'Update the details or change who is assigned.' : 'Describe it, set priority and dates, then choose who does it.'}
          actions={
            <>
              <Button className="wd-soft" h={42} px={18} onClick={() => navigate(-1)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" h={42} px={20} fw={600} loading={saving}>
                {original ? 'Save changes' : 'Create work'}
              </Button>
            </>
          }
        />

        {formError && (
          <Alert color="red" variant="light" radius="lg" icon={<AlertCircle size={18} />}>
            {formError}
          </Alert>
        )}

        <Group align="flex-start" gap={20} wrap="wrap">
          <Bezel
            title="Details"
            extra={<Text size="xs" c="dimmed">Title is required</Text>}
            padding={22}
            style={{ flex: '3 1 520px', minWidth: 0 }}
          >
            <Stack gap={18}>
              <TextInput
                label="Title"
                size="lg"
                maxLength={200}
                value={form.title}
                onChange={(e) => set('title', e.currentTarget.value)}
                error={errors.title}
                data-autofocus
                autoFocus
                styles={{ input: { fontSize: 17, fontWeight: 500 } }}
              />
              <Textarea
                label="Description"
                autosize
                minRows={4}
                maxRows={12}
                maxLength={8000}
                value={form.description}
                onChange={(e) => set('description', e.currentTarget.value)}
                error={errors.description}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={14}>
                <Select
                  label="Product group"
                  placeholder="None"
                  size="md"
                  searchable
                  clearable
                  data={groupOptions.map((g) => ({ value: String(g.productGroupId), label: g.groupName }))}
                  value={form.productGroupId || null}
                  onChange={(v) => setForm((f) => ({ ...f, productGroupId: v ?? '', productId: '' }))}
                  error={errors.productGroupId}
                />
                <Select
                  label="Product"
                  placeholder="None"
                  size="md"
                  searchable
                  clearable
                  data={productOptions.map((p) => ({ value: String(p.productId), label: `${p.productName} · ${p.productCode}` }))}
                  value={form.productId || null}
                  onChange={(v) => onProductChange(v ?? '')}
                  error={errors.productId}
                />
              </SimpleGrid>
              <Box>
                <Text c="dimmed" mb={6}>
                  Priority
                </Text>
                <SegmentedControl
                  fullWidth
                  size="md"
                  value={form.priority}
                  onChange={(v) => set('priority', v as Priority)}
                  data={PRIORITIES.map((p) => ({ value: p, label: <PriorityMark priority={p} /> }))}
                />
                {errors.priority && (
                  <Text size="xs" c="red" mt={4}>
                    {errors.priority}
                  </Text>
                )}
              </Box>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={14}>
                <DatePickerInput
                  label="Start date"
                  placeholder="Pick a date"
                  size="md"
                  clearable
                  valueFormat="ddd, D MMM YYYY"
                  value={parseDateInput(form.startDate)}
                  onChange={(d) => set('startDate', d ? toDateInput(d) : '')}
                  error={errors.startDate}
                />
                <DatePickerInput
                  label="Due date"
                  placeholder="Pick a date"
                  size="md"
                  clearable
                  valueFormat="ddd, D MMM YYYY"
                  minDate={parseDateInput(form.startDate) ?? undefined}
                  value={parseDateInput(form.dueDate)}
                  onChange={(d) => set('dueDate', d ? toDateInput(d) : '')}
                  error={errors.dueDate}
                  description={dueDays !== null && dueDays >= 0 ? `${dueDays} day${dueDays === 1 ? '' : 's'} after start` : undefined}
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                />
              </SimpleGrid>
            </Stack>
          </Bezel>

          <Bezel
            title="Assign"
            count={form.employeeIds.length}
            extra={
              form.employeeIds.length > 0 && (
                <Button variant="subtle" color="gray" size="compact-sm" onClick={() => set('employeeIds', [])}>
                  Clear
                </Button>
              )
            }
            padding={14}
            style={{ flex: '2 1 340px', minWidth: 0 }}
          >
            {errors.employeeIds && (
              <Alert color="red" variant="light" radius="md" mb="sm">
                {errors.employeeIds}
              </Alert>
            )}
            <TextInput
              type="search"
              aria-label="Search employees"
              placeholder="Search name, code or department"
              leftSection={<Search size={16} />}
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.currentTarget.value)}
            />
            <ScrollArea.Autosize mah={460} type="auto" offsetScrollbars mt={8}>
              {departments.length === 0 && (
                <Text c="dimmed" ta="center" py="lg">
                  No employees match.
                </Text>
              )}
              {departments.map(([dept, people]) => (
                <div key={dept}>
                  <Text className="wd-eyebrow" fz={12} px={8} pt={12} pb={4}>
                    {dept}
                  </Text>
                  {people.map((e) => {
                    const checked = form.employeeIds.includes(e.employeeId);
                    return (
                      <label key={e.employeeId} className="wd-pick" data-checked={checked}>
                        <PersonAvatar name={e.employeeName} size={32} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <Text fw={500} truncate>
                            {e.employeeName}
                          </Text>
                          <Text size="xs" c="dimmed">
                            <span className="wd-mono">{e.employeeCode}</span>
                            {!e.isActive ? ' · inactive' : ''}
                          </Text>
                        </span>
                        <Checkbox checked={checked} onChange={() => toggleEmployee(e.employeeId)} radius="sm" aria-label={`Assign ${e.employeeName}`} />
                      </label>
                    );
                  })}
                </div>
              ))}
            </ScrollArea.Autosize>
          </Bezel>
        </Group>
      </Stack>
    </form>
  );
}
