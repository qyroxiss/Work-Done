import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Button, Group, Menu, ScrollArea, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { Bezel, DueChip, EmptyState, ErrorBanner, PageHeader, PersonAvatar, PriorityMark, Spinner, StatusBadge } from '../components/common';
import { useLookups } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { api, errorMessage, qs } from '../services/api';
import type { WorkListItem } from '../types';
import { downloadCsv, firstOfMonthInput, formatDate, formatDateTime, parseDateInput, toDateInput, todayInput } from '../utils/format';
import { downloadXlsx, sheetDate, type SheetValue } from '../utils/xlsx';

type ReportKey = 'employee' | 'pending' | 'overdue' | 'completed' | 'summary';

const REPORTS: { key: ReportKey; label: string; endpoint: string; range: 'none' | 'optional' | 'required'; description: string }[] = [
  { key: 'employee', label: 'By employee', endpoint: '/reports/employee-work', range: 'optional', description: 'Active assignments per employee by status. The date range filters by the date work was created.' },
  { key: 'pending', label: 'Pending', endpoint: '/reports/pending-work', range: 'none', description: 'All open work (Pending, In Progress, On Hold, Reopened) as of today.' },
  { key: 'overdue', label: 'Overdue', endpoint: '/reports/overdue-work', range: 'none', description: 'Open work past its due date as of today.' },
  { key: 'completed', label: 'Completed', endpoint: '/reports/completed-work', range: 'required', description: 'Work completed (submitted) within the date range, including closed work.' },
  { key: 'summary', label: 'Daily summary', endpoint: '/reports/work-summary', range: 'required', description: 'Day-by-day counts of work created, due, completed, closed and reopened.' },
];

interface EmployeeRow {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  total: number;
  pending: number;
  inProgress: number;
  onHold: number;
  reopened: number;
  completed: number;
  closed: number;
  overdue: number;
}
interface WorkRow extends WorkListItem {
  daysOverdue?: number;
  completedAt?: string;
  completedByName?: string;
  onTime?: boolean | null;
}
interface SummaryRow {
  date: string;
  created: number;
  due: number;
  completed: number;
  closed: number;
  reopened: number;
}
interface ReportResult {
  rows: (EmployeeRow | WorkRow | SummaryRow)[];
  totals?: Omit<SummaryRow, 'date'>;
}

interface Sheet {
  headers: string[];
  rows: SheetValue[][];
}

export function ReportsPage() {
  const toast = useToast();
  const { employees, groups } = useLookups({ employees: true, includeInactive: true });
  const [report, setReport] = useState<ReportKey>('employee');
  const [fromDate, setFromDate] = useState(firstOfMonthInput());
  const [toDate, setToDate] = useState(todayInput());
  const [employeeId, setEmployeeId] = useState('');
  const [productGroupId, setProductGroupId] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = REPORTS.find((r) => r.key === report)!;

  const run = useCallback(async () => {
    if (def.range === 'required' && (!fromDate || !toDate)) return;
    setLoading(true);
    setError(null);
    try {
      const useRange = def.range !== 'none';
      const query = qs({
        fromDate: useRange ? fromDate : undefined,
        toDate: useRange ? toDate : undefined,
        employeeId,
        productGroupId,
      });
      setResult(await api.get<ReportResult>(`${def.endpoint}${query}`));
    } catch (err) {
      setError(errorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [def, fromDate, toDate, employeeId, productGroupId]);

  useEffect(() => {
    void run();
  }, [run]);

  /** The current report as plain rows; shared by the CSV and Excel exports. */
  const toSheet = (): Sheet | null => {
    if (!result) return null;
    if (report === 'employee') {
      const rows = result.rows as EmployeeRow[];
      return {
        headers: ['Code', 'Employee', 'Department', 'Total', 'Pending', 'In Progress', 'On Hold', 'Reopened', 'Completed', 'Closed', 'Overdue'],
        rows: rows.map((r) => [r.employeeCode, r.employeeName, r.department, r.total, r.pending, r.inProgress, r.onHold, r.reopened, r.completed, r.closed, r.overdue]),
      };
    }
    if (report === 'summary') {
      const rows = result.rows as SummaryRow[];
      return {
        headers: ['Date', 'Created', 'Due', 'Completed', 'Closed', 'Reopened'],
        rows: rows.map((r) => [sheetDate(r.date), r.created, r.due, r.completed, r.closed, r.reopened]),
      };
    }
    const rows = result.rows as WorkRow[];
    const extra = report === 'completed' ? ['Completed at', 'Completed by', 'On time'] : ['Days overdue'];
    return {
      headers: ['Work No', 'Title', 'Product', 'Group', 'Assigned to', 'Priority', 'Status', 'Start', 'Due', ...extra],
      rows: rows.map((r) => [
        r.workNo,
        r.title,
        r.productName,
        r.groupName,
        r.assignees.map((a) => a.employeeName).join('; '),
        r.priority,
        r.status,
        sheetDate(r.startDate),
        sheetDate(r.dueDate),
        ...(report === 'completed'
          ? [formatDateTime(r.completedAt), r.completedByName, r.onTime === null ? '' : r.onTime ? 'Yes' : 'No']
          : [r.daysOverdue ?? 0]),
      ]),
    };
  };

  const fileBase = `workdone-${report}-${todayInput()}`;

  const exportCsv = () => {
    const sheet = toSheet();
    if (!sheet) return;
    const csvRows = sheet.rows.map((r) => r.map((v) => (v instanceof Date ? toDateInput(v) : v)));
    downloadCsv(`${fileBase}.csv`, sheet.headers, csvRows);
  };

  const exportXlsx = async () => {
    const sheet = toSheet();
    if (!sheet) return;
    try {
      await downloadXlsx(`${fileBase}.xlsx`, def.label, sheet.headers, sheet.rows);
    } catch (err) {
      toast.error(`Could not create the Excel file: ${errorMessage(err)}`);
    }
  };

  const hasRows = Boolean(result?.rows.length);
  const chip = (value: string) => ({ className: 'wd-chip', 'data-active': value !== '', radius: 'xl' as const });

  return (
    <Stack gap={24}>
      <PageHeader
        title="Reports"
        subtitle={def.description}
        actions={
          <Group gap="xs" className="no-print">
            <Button className="wd-soft" leftSection={<Printer size={16} />} onClick={() => window.print()} disabled={!hasRows}>
              Print
            </Button>
            <Menu position="bottom-end" radius="lg" shadow="md" width={200}>
              <Menu.Target>
                <Button className="wd-ink" leftSection={<Download size={16} />} rightSection={<ChevronDown size={14} />} disabled={!hasRows}>
                  Export
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<FileSpreadsheet size={15} />} onClick={exportXlsx}>
                  Excel (.xlsx)
                </Menu.Item>
                <Menu.Item leftSection={<FileText size={15} />} onClick={exportCsv}>
                  CSV
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        }
      />

      <Stack gap={12} className="no-print">
        <ScrollArea type="never" offsetScrollbars={false}>
          <SegmentedControl
            aria-label="Report"
            value={report}
            onChange={(v) => {
              setResult(null);
              setReport(v as ReportKey);
            }}
            data={REPORTS.map((r) => ({ value: r.key, label: r.label }))}
          />
        </ScrollArea>
        <Group gap={8} wrap="wrap">
          {def.range !== 'none' && (
            <DatePickerInput
              className="wd-chip"
              data-active
              radius="xl"
              type="range"
              aria-label="Date range"
              allowSingleDateInRange
              valueFormat="D MMM YYYY"
              miw={230}
              value={[parseDateInput(fromDate), parseDateInput(toDate)]}
              onChange={([from, to]) => {
                setFromDate(from ? toDateInput(from) : '');
                setToDate(to ? toDateInput(to) : '');
              }}
            />
          )}
          <Select
            {...chip(employeeId)}
            w={190}
            aria-label="Employee"
            placeholder="All employees"
            searchable
            clearable
            data={employees.map((e) => ({ value: String(e.employeeId), label: e.employeeName }))}
            value={employeeId || null}
            onChange={(v) => setEmployeeId(v ?? '')}
          />
          <Select
            {...chip(productGroupId)}
            w={190}
            aria-label="Product group"
            placeholder="All product groups"
            searchable
            clearable
            data={groups.map((g) => ({ value: String(g.productGroupId), label: g.groupName }))}
            value={productGroupId || null}
            onChange={(v) => setProductGroupId(v ?? '')}
          />
        </Group>
      </Stack>

      <div className="print-only">
        <h2>Q-WorkDone · {def.label} report</h2>
        <p>
          {def.range !== 'none' ? `${formatDate(fromDate)} – ${formatDate(toDate)} · ` : ''}Printed {formatDateTime(new Date().toISOString())}
        </p>
      </div>

      {error && <ErrorBanner message={error} onRetry={run} />}

      <Bezel
        title={def.label}
        count={result?.rows.length}
        footer={
          hasRows ? (
            <Text size="sm" c="dimmed">
              {result!.rows.length} {result!.rows.length === 1 ? 'row' : 'rows'}
            </Text>
          ) : undefined
        }
      >
        {loading && !result ? (
          <Spinner />
        ) : !result || result.rows.length === 0 ? (
          !error && <EmptyState title="Nothing to show">Try a different date range or clear the filters.</EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={report === 'summary' ? 520 : 900} className={loading ? 'table-loading' : undefined}>
            {report === 'employee' && <EmployeeTable rows={result.rows as EmployeeRow[]} />}
            {report === 'summary' && <SummaryTable rows={result.rows as SummaryRow[]} totals={result.totals!} />}
            {(report === 'pending' || report === 'overdue' || report === 'completed') && <WorkTable rows={result.rows as WorkRow[]} mode={report} />}
          </Table.ScrollContainer>
        )}
      </Bezel>
    </Stack>
  );
}

function Num({ children, highlight, strong }: { children: ReactNode; highlight?: boolean; strong?: boolean }) {
  return (
    <Table.Td ta="right" style={{ fontVariantNumeric: 'tabular-nums' }} c={highlight ? 'red.7' : undefined} fw={highlight || strong ? 600 : undefined}>
      {children}
    </Table.Td>
  );
}

const tableProps = { verticalSpacing: 12, horizontalSpacing: 'sm', className: 'wd-table' } as const;

function EmployeeTable({ rows }: { rows: EmployeeRow[] }) {
  const sum = (k: keyof EmployeeRow) => rows.reduce((t, r) => t + (r[k] as number), 0);
  const cols: [keyof EmployeeRow, string][] = [
    ['total', 'Total'],
    ['pending', 'Pending'],
    ['inProgress', 'In progress'],
    ['onHold', 'On hold'],
    ['reopened', 'Reopened'],
    ['completed', 'Completed'],
    ['closed', 'Closed'],
    ['overdue', 'Overdue'],
  ];
  return (
    <Table {...tableProps}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Employee</Table.Th>
          <Table.Th className="hide-sm">Department</Table.Th>
          {cols.map(([, label]) => (
            <Table.Th key={label} ta="right">
              {label}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.employeeId}>
            <Table.Td>
              <Group gap={10} wrap="nowrap">
                <PersonAvatar name={r.employeeName} size={28} />
                <div>
                  <Text fw={500}>{r.employeeName}</Text>
                  <Text className="wd-mono" c="dimmed" size="xs">
                    {r.employeeCode}
                  </Text>
                </div>
              </Group>
            </Table.Td>
            <Table.Td className="hide-sm">{r.department ?? '—'}</Table.Td>
            {cols.map(([k]) => (
              <Num key={k} highlight={k === 'overdue' && r.overdue > 0} strong={k === 'total'}>
                {r[k] as number}
              </Num>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
      <Table.Tfoot>
        <Table.Tr>
          <Table.Th>Total</Table.Th>
          <Table.Th className="hide-sm" />
          {cols.map(([k, label]) => (
            <Table.Th key={label} ta="right">
              {sum(k)}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Tfoot>
    </Table>
  );
}

function WorkTable({ rows, mode }: { rows: WorkRow[]; mode: 'pending' | 'overdue' | 'completed' }) {
  return (
    <Table {...tableProps}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Work</Table.Th>
          <Table.Th className="hide-sm">Product</Table.Th>
          <Table.Th>Assigned to</Table.Th>
          <Table.Th>Priority</Table.Th>
          <Table.Th>Due</Table.Th>
          <Table.Th>Status</Table.Th>
          {mode === 'completed' ? (
            <>
              <Table.Th>Completed</Table.Th>
              <Table.Th>On time</Table.Th>
            </>
          ) : (
            <Table.Th ta="right">Days overdue</Table.Th>
          )}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.workId}>
            <Table.Td maw={340}>
              <Text fw={500} truncate>
                {r.title}
              </Text>
              <Anchor component={Link} to={`/work?id=${r.workId}`} className="wd-mono" size="xs">
                {r.workNo}
              </Anchor>
            </Table.Td>
            <Table.Td className="hide-sm">{r.productName ?? r.groupName ?? '—'}</Table.Td>
            <Table.Td>{r.assignees.map((a) => a.employeeName).join(', ') || <Text c="dimmed">Unassigned</Text>}</Table.Td>
            <Table.Td>
              <PriorityMark priority={r.priority} />
            </Table.Td>
            <Table.Td style={{ whiteSpace: 'nowrap' }}>
              {mode === 'completed' ? formatDate(r.dueDate) : <DueChip dueDate={r.dueDate} isOverdue={r.isOverdue} />}
            </Table.Td>
            <Table.Td>
              <StatusBadge status={r.status} />
            </Table.Td>
            {mode === 'completed' ? (
              <>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(r.completedAt)}
                  <Text size="xs" c="dimmed">
                    {r.completedByName}
                  </Text>
                </Table.Td>
                <Table.Td>{r.onTime === null ? '—' : r.onTime ? 'Yes' : <Text c="red.7" fw={600} span>No</Text>}</Table.Td>
              </>
            ) : (
              <Num highlight={(r.daysOverdue ?? 0) > 0}>{r.daysOverdue || '—'}</Num>
            )}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function SummaryTable({ rows, totals }: { rows: SummaryRow[]; totals: Omit<SummaryRow, 'date'> }) {
  return (
    <Table {...tableProps}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Date</Table.Th>
          <Table.Th ta="right">Created</Table.Th>
          <Table.Th ta="right">Due</Table.Th>
          <Table.Th ta="right">Completed</Table.Th>
          <Table.Th ta="right">Closed</Table.Th>
          <Table.Th ta="right">Reopened</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.date} style={r.created + r.due + r.completed + r.closed + r.reopened === 0 ? { opacity: 0.45 } : undefined}>
            <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</Table.Td>
            <Num>{r.created}</Num>
            <Num>{r.due}</Num>
            <Num>{r.completed}</Num>
            <Num>{r.closed}</Num>
            <Num highlight={r.reopened > 0}>{r.reopened}</Num>
          </Table.Tr>
        ))}
      </Table.Tbody>
      <Table.Tfoot>
        <Table.Tr>
          <Table.Th>Total</Table.Th>
          <Table.Th ta="right">{totals.created}</Table.Th>
          <Table.Th ta="right">{totals.due}</Table.Th>
          <Table.Th ta="right">{totals.completed}</Table.Th>
          <Table.Th ta="right">{totals.closed}</Table.Th>
          <Table.Th ta="right">{totals.reopened}</Table.Th>
        </Table.Tr>
      </Table.Tfoot>
    </Table>
  );
}
