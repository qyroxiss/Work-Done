import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionIcon, Box, Button, Group, Popover, SegmentedControl, Select, Stack, Switch, Table, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { ArrowDown, ArrowUp, Bookmark, BookmarkPlus, Repeat, Search, X } from 'lucide-react';
import { Bezel, DueChip, EmptyState, ErrorBanner, PageHeader, Pagination, PersonAvatar, PriorityMark, Spinner, StatusBadge } from '../components/common';
import { WorkDetailPanel } from '../components/WorkDetailPanel';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useLookups } from '../hooks/useLookups';
import { api, errorMessage, qs } from '../services/api';
import { OPEN_STATUSES, PRIORITIES, type Assignee, type Paged, type WorkListItem } from '../types';
import { parseDateInput, relativeTime, toDateInput } from '../utils/format';

interface Filters {
  search: string;
  status: string;
  priority: string;
  employeeId: string;
  productGroupId: string;
  productId: string;
  assignment: string;
  dateField: string;
  fromDate: string;
  toDate: string;
  overdue: boolean;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  status: 'open',
  priority: '',
  employeeId: '',
  productGroupId: '',
  productId: '',
  assignment: '',
  dateField: 'due',
  fromDate: '',
  toDate: '',
  overdue: false,
};

type SortKey = 'workNo' | 'title' | 'product' | 'priority' | 'dueDate' | 'status' | 'updatedAt';

/** View tabs; "all" stands for no status filter (Mantine controls need non-empty values) */
const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'Completed', label: 'Review' },
  { value: 'On Hold', label: 'On hold' },
  { value: 'Closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];
const statusParam = (tab: string) => (tab === 'open' ? OPEN_STATUSES.join(',') : tab === 'all' ? '' : tab);

const DATE_FIELDS = [
  { value: 'due', label: 'Due date' },
  { value: 'start', label: 'Start date' },
  { value: 'created', label: 'Created' },
];

export function WorkGridPage() {
  const { hasRole, user } = useAuth();
  const isManager = hasRole('Admin', 'Manager');
  const { employees, groups, products } = useLookups({ employees: isManager });
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    ...(searchParams.get('overdue') === 'true' ? { overdue: true } : {}),
    ...(searchParams.get('status') ? { status: searchParams.get('status')! } : {}),
    ...(searchParams.get('assignment') ? { assignment: searchParams.get('assignment')! } : {}),
  }));
  const [sortBy, setSortBy] = useState<SortKey>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Paged<WorkListItem> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isPhone = useMediaQuery('(max-width: 48em)');
  const selectedId = Number(searchParams.get('id')) || null;
  const debouncedSearch = useDebounce(filters.search);

  // Every filter except status: shared by the list and the tab counts
  const baseQuery = {
    search: debouncedSearch,
    priority: filters.priority,
    employeeId: filters.employeeId,
    productGroupId: filters.productGroupId,
    productId: filters.productId,
    assignment: filters.assignment,
    dateField: filters.fromDate || filters.toDate ? filters.dateField : undefined,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    overdue: filters.overdue ? 'true' : undefined,
  };
  const baseString = qs(baseQuery);
  const queryString = qs({ ...baseQuery, status: statusParam(filters.status), sortBy, sortDir, page, pageSize });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Paged<WorkListItem>>(`/work-items${queryString}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const loadCounts = useCallback(async () => {
    const base = Object.fromEntries(new URLSearchParams(baseString));
    const results = await Promise.all(
      TABS.map((t) =>
        api
          .get<Paged<WorkListItem>>(`/work-items${qs({ ...base, status: statusParam(t.value), pageSize: 1 })}`)
          .then((r) => [t.value, r.total] as const)
          .catch(() => [t.value, NaN] as const),
      ),
    );
    setCounts(Object.fromEntries(results));
  }, [baseString]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const refresh = useCallback(() => {
    void load();
    void loadCounts();
  }, [load, loadCounts]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => {
      const next = { ...f, [key]: value };
      // Product must belong to the chosen group
      if (key === 'productGroupId') next.productId = '';
      return next;
    });
    setPage(1);
  };

  const filteredProducts = useMemo(
    () => (filters.productGroupId ? products.filter((p) => String(p.productGroupId) === filters.productGroupId) : products),
    [products, filters.productGroupId],
  );

  const activeFilterCount = (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).filter(
    (k) => k !== 'dateField' && k !== 'status' && filters[k] !== EMPTY_FILTERS[k],
  ).length;

  const sort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir(key === 'updatedAt' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const openDetail = (id: number | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('id', String(id));
    else next.delete('id');
    setSearchParams(next, { replace: true });
  };

  const tabValue = TABS.some((t) => t.value === filters.status) ? filters.status : filters.status === '' ? 'all' : 'open';
  const sortProps = { sortBy, sortDir, onSort: sort };
  const chip = (value: string) => ({ className: 'wd-chip', 'data-active': value !== '', size: 'sm' as const, radius: 'xl' as const });

  return (
    <Stack gap={24}>
      <PageHeader
        title={isManager ? 'Work' : 'My work'}
        count={counts.all}
        subtitle={isManager ? 'Everything your office is working on. Open a row for details and history.' : 'Work assigned to you. Open a row to update its status.'}
        actions={
          isManager && (
            <Button component={Link} to="/recurring" className="wd-soft" leftSection={<Repeat size={15} />}>
              Repeating work
            </Button>
          )
        }
      />

      <Group gap={8} wrap="wrap">
        <TextInput
          type="search"
          aria-label="Search work"
          placeholder="Search… (work no, title or description)"
          leftSection={<Search size={16} />}
          value={filters.search}
          onChange={(e) => setFilter('search', e.currentTarget.value)}
          style={{ flex: '1 1 280px' }}
        />
        <SegmentedControl
          aria-label="View"
          value={tabValue}
          onChange={(v) => setFilter('status', v === 'all' ? '' : v)}
          data={TABS.map((t) => ({
            value: t.value,
            label: (
              <span>
                {t.label}{' '}
                <Text span size="xs" c="dimmed">
                  {Number.isNaN(counts[t.value]) ? '' : counts[t.value]}
                </Text>
              </span>
            ),
          }))}
        />
      </Group>

      <Group gap={8} wrap="wrap" mt={-10}>
        <Select
          {...chip(filters.priority)}
          w={140}
          aria-label="Priority"
          placeholder="Priority"
          clearable
          data={PRIORITIES}
          value={filters.priority || null}
          onChange={(v) => setFilter('priority', v ?? '')}
        />
        {isManager && (
          <Select
            {...chip(filters.employeeId)}
            w={170}
            aria-label="People"
            placeholder="People"
            searchable
            clearable
            data={employees.map((e) => ({ value: String(e.employeeId), label: e.employeeName }))}
            value={filters.employeeId || null}
            onChange={(v) => setFilter('employeeId', v ?? '')}
          />
        )}
        <Select
          {...chip(filters.productGroupId)}
          w={170}
          aria-label="Product group"
          placeholder="Product group"
          searchable
          clearable
          data={groups.map((g) => ({ value: String(g.productGroupId), label: g.groupName }))}
          value={filters.productGroupId || null}
          onChange={(v) => setFilter('productGroupId', v ?? '')}
        />
        <Select
          {...chip(filters.productId)}
          w={160}
          aria-label="Product"
          placeholder="Product"
          searchable
          clearable
          data={filteredProducts.map((p) => ({ value: String(p.productId), label: p.productName }))}
          value={filters.productId || null}
          onChange={(v) => setFilter('productId', v ?? '')}
        />
        {isManager && (
          <Select
            {...chip(filters.assignment)}
            w={150}
            aria-label="Assignment"
            placeholder="Assignment"
            clearable
            data={[
              { value: 'assigned', label: 'Assigned' },
              { value: 'unassigned', label: 'Unassigned' },
            ]}
            value={filters.assignment || null}
            onChange={(v) => setFilter('assignment', v ?? '')}
          />
        )}
        <Select
          {...chip(filters.fromDate || filters.toDate)}
          w={120}
          aria-label="Date field"
          allowDeselect={false}
          data={DATE_FIELDS}
          value={filters.dateField}
          onChange={(v) => setFilter('dateField', v ?? 'due')}
        />
        <DatePickerInput
          {...chip(filters.fromDate || filters.toDate)}
          type="range"
          aria-label="Date range"
          placeholder="Any date"
          clearable
          allowSingleDateInRange
          valueFormat="D MMM"
          miw={150}
          value={[parseDateInput(filters.fromDate), parseDateInput(filters.toDate)]}
          onChange={([from, to]) => {
            setFilters((f) => ({ ...f, fromDate: from ? toDateInput(from) : '', toDate: to ? toDateInput(to) : '' }));
            setPage(1);
          }}
        />
        <Switch label="Overdue only" color="red" checked={filters.overdue} onChange={(e) => setFilter('overdue', e.currentTarget.checked)} ml={4} />
        {activeFilterCount > 0 && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            leftSection={<X size={14} />}
            onClick={() => {
              setFilters((f) => ({ ...EMPTY_FILTERS, status: f.status }));
              setPage(1);
            }}
          >
            Clear
          </Button>
        )}
      </Group>

      <SavedViews
        storageKey={user ? `wd-views:${user.clientId}:${user.userId}` : null}
        current={filters}
        canSave={activeFilterCount > 0 || filters.status !== EMPTY_FILTERS.status}
        onApply={(f) => {
          setFilters({ ...EMPTY_FILTERS, ...f, search: f.search ?? '' });
          setPage(1);
        }}
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

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
          <EmptyState title="No work found">
            {activeFilterCount > 0 ? 'Try changing or clearing the filters.' : isManager ? 'Create a work item to get started.' : 'Nothing is assigned to you here.'}
          </EmptyState>
        ) : isPhone ? (
          <Stack gap={0} p={6} className={loading ? 'table-loading' : undefined}>
            {data?.items.map((w) => (
              <UnstyledButton key={w.workId} className="wd-row" onClick={() => openDetail(w.workId)} style={{ display: 'block' }}>
                <Group justify="space-between" gap={8} wrap="nowrap">
                  <StatusBadge status={w.status} />
                  <DueChip dueDate={w.dueDate} isOverdue={w.isOverdue} done={w.status === 'Completed' || w.status === 'Closed'} />
                </Group>
                <Text fw={500} fz={16} mt={10} lh={1.35}>
                  {w.title}
                </Text>
                <Group justify="space-between" mt={8} gap={8} wrap="nowrap">
                  <Text className="wd-mono" c="dimmed">
                    {w.workNo}
                  </Text>
                  <Group gap={8} wrap="nowrap">
                    <PriorityMark priority={w.priority} label={false} />
                    <Text size="xs" c="dimmed" truncate maw={150}>
                      {w.assignees.map((a) => a.employeeName.split(' ')[0]).join(', ') || 'Unassigned'}
                    </Text>
                  </Group>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        ) : (
          <Table.ScrollContainer minWidth={980} className={loading ? 'table-loading' : undefined}>
            <Table verticalSpacing={14} horizontalSpacing="sm" className="wd-table">
              <Table.Thead>
                <Table.Tr>
                  <SortTh k="title" label="Work" {...sortProps} />
                  <SortTh k="product" label="Product" {...sortProps} />
                  <Table.Th>People</Table.Th>
                  <SortTh k="priority" label="Priority" {...sortProps} />
                  <SortTh k="dueDate" label="Due" {...sortProps} />
                  <SortTh k="status" label="Status" {...sortProps} />
                  <SortTh k="updatedAt" label="Updated" {...sortProps} align="right" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.items.map((w) => (
                  <Table.Tr
                    key={w.workId}
                    data-selected={selectedId === w.workId}
                    onClick={() => openDetail(w.workId)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && openDetail(w.workId)}
                  >
                    <Table.Td maw={360}>
                      <Text fw={500} fz={15} truncate>
                        {w.title}
                      </Text>
                      <Text className="wd-mono" c="dimmed" mt={3}>
                        {w.workNo}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text>{w.productName ?? '—'}</Text>
                      <Text size="xs" c="dimmed" mt={3}>
                        {w.groupName ?? 'No group'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <People assignees={w.assignees} />
                    </Table.Td>
                    <Table.Td>
                      <PriorityMark priority={w.priority} />
                    </Table.Td>
                    <Table.Td>
                      <DueChip dueDate={w.dueDate} isOverdue={w.isOverdue} done={w.status === 'Completed' || w.status === 'Closed'} />
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={w.status} />
                    </Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }} title={w.updatedAt}>
                      <Text c="dimmed">{relativeTime(w.updatedAt)}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Bezel>

      {selectedId && <WorkDetailPanel workId={selectedId} onClose={() => openDetail(null)} onChanged={refresh} />}
    </Stack>
  );
}

interface SavedView {
  name: string;
  filters: Partial<Filters>;
}

function readViews(key: string | null): SavedView[] {
  if (!key) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SavedView[]).filter((v) => v && typeof v.name === 'string') : [];
  } catch {
    return [];
  }
}

/** Named filter sets, kept in this browser for this user (e.g. "My overdue", "Kapoor Traders – this month"). */
function SavedViews({
  storageKey,
  current,
  canSave,
  onApply,
}: {
  storageKey: string | null;
  current: Filters;
  canSave: boolean;
  onApply: (filters: Partial<Filters>) => void;
}) {
  const [views, setViews] = useState<SavedView[]>(() => readViews(storageKey));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const persist = (next: SavedView[]) => {
    setViews(next);
    try {
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage unavailable (private window): views last until the page is closed */
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    // Only what differs from the defaults is stored, so views stay valid if new filters are added later
    const filters = Object.fromEntries(
      (Object.keys(current) as (keyof Filters)[]).filter((k) => current[k] !== EMPTY_FILTERS[k]).map((k) => [k, current[k]]),
    ) as Partial<Filters>;
    persist([...views.filter((v) => v.name !== clean), { name: clean, filters }]);
    setName('');
    setNaming(false);
  };

  if (views.length === 0 && !canSave) return null;
  return (
    <Group gap={6} mt={-12} wrap="wrap">
      {views.length > 0 && <Bookmark size={14} color="var(--wd-muted)" aria-hidden />}
      {views.map((v) => (
        <span key={v.name} className="wd-view-chip" role="button" tabIndex={0} onClick={() => onApply(v.filters)} onKeyDown={(e) => e.key === 'Enter' && onApply(v.filters)}>
          {v.name}
          <ActionIcon
            size={18}
            radius="xl"
            variant="subtle"
            color="gray"
            aria-label={`Delete view ${v.name}`}
            onClick={(e) => {
              e.stopPropagation();
              persist(views.filter((x) => x.name !== v.name));
            }}
          >
            <X size={11} />
          </ActionIcon>
        </span>
      ))}
      {canSave && (
        <Popover opened={naming} onChange={setNaming} position="bottom-start" radius="lg" shadow="md" trapFocus>
          <Popover.Target>
            <Button variant="subtle" color="gray" size="compact-sm" leftSection={<BookmarkPlus size={14} />} onClick={() => setNaming((o) => !o)}>
              Save view
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <form onSubmit={save}>
              <Group gap={6}>
                <TextInput size="xs" placeholder="Name, e.g. My overdue" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={40} w={200} data-autofocus />
                <Button type="submit" size="xs" className="wd-ink" disabled={!name.trim()}>
                  Save
                </Button>
              </Group>
            </form>
          </Popover.Dropdown>
        </Popover>
      )}
    </Group>
  );
}

interface SortThProps {
  k: SortKey;
  label: string;
  sortBy: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  align?: 'right';
}

function SortTh({ k, label, sortBy, sortDir, onSort, align }: SortThProps) {
  const active = sortBy === k;
  return (
    <Table.Th ta={align} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <UnstyledButton className="wd-sort" data-active={active} onClick={() => onSort(k)}>
        <Group gap={4} wrap="nowrap" justify={align === 'right' ? 'flex-end' : undefined}>
          {label}
          {active && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

function People({ assignees }: { assignees: Assignee[] }) {
  if (assignees.length === 0) return <Text c="dimmed">Unassigned</Text>;
  const label = assignees.length === 1 ? assignees[0].employeeName : `${assignees[0].employeeName.split(' ')[0]} +${assignees.length - 1}`;
  return (
    <Tooltip label={assignees.map((a) => a.employeeName).join(', ')} withArrow disabled={assignees.length === 1}>
      <Group gap={10} wrap="nowrap">
        <span className="wd-avatar-stack" style={{ display: 'inline-flex' }}>
          {assignees.slice(0, 3).map((a) => (
            <PersonAvatar key={a.employeeId} name={a.employeeName} size={28} />
          ))}
        </span>
        <Text truncate maw={150}>
          {label}
        </Text>
      </Group>
    </Tooltip>
  );
}
