import type { CSSProperties, ReactNode } from 'react';
import { Alert, Button, Center, Group, Loader, Pagination as MantinePagination, Select, Stack, Text } from '@mantine/core';
import { AlertCircle } from 'lucide-react';
import type { Priority, WorkStatus } from '../types';
import { formatDate, parseDateInput, todayInput } from '../utils/format';

export const STATUS_DOT: Record<WorkStatus, string> = {
  Pending: '#9B9A96',
  'In Progress': '#0A6CFF',
  'On Hold': '#F59E0B',
  Completed: '#12A150',
  Closed: 'var(--mantine-color-text)',
  Reopened: '#F04438',
};

const dot = (color: string) => ({ '--dot': color }) as CSSProperties;

export function StatusBadge({ status }: { status: WorkStatus }) {
  return (
    <span className="wd-status">
      <span className="wd-dot" style={dot(STATUS_DOT[status])} />
      {status}
    </span>
  );
}

const BARS: Record<Exclude<Priority, 'Urgent'>, [number, number, number]> = {
  Low: [1, 0.2, 0.2],
  Medium: [1, 1, 0.2],
  High: [1, 1, 1],
};

/** Signal bars for Low–High; Urgent is the only red mark. */
export function PriorityMark({ priority, label = true }: { priority: Priority; label?: boolean }) {
  return (
    <span className="wd-priority" title={`${priority} priority`}>
      {priority === 'Urgent' ? (
        <span className="wd-urgent" aria-hidden="true">
          !
        </span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          {[
            [1.5, 9, 5],
            [6.5, 5.5, 8.5],
            [11.5, 2, 12],
          ].map(([x, y, h], i) => (
            <rect key={x} x={x} y={y} width="3" height={h} rx="1.5" fill="currentColor" opacity={BARS[priority][i]} />
          ))}
        </svg>
      )}
      {label ? priority : <span className="sr-only">{priority} priority</span>}
    </span>
  );
}

/** Kept for screens that still import the old name. */
export const PriorityBadge = PriorityMark;

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className="wd-status">
      <span className="wd-dot" style={dot(active ? '#12A150' : '#9B9A96')} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

const TINTS: [string, string][] = [
  ['#DCE8FF', '#1A3E80'],
  ['#F7DCE4', '#7A1F3D'],
  ['#DDF0E3', '#1D5B33'],
  ['#EEE3FA', '#4B2A75'],
  ['#FCE8CF', '#7A4A0E'],
  ['#D9F0F2', '#1C5A60'],
  ['#E9D7C3', '#5B3A17'],
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Soft per-person color, stable for the same name. */
export function PersonAvatar({ name, size = 30 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = TINTS[h % TINTS.length];
  return (
    <span className="wd-avatar" title={name} style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.36) }}>
      {initials(name)}
    </span>
  );
}

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** "2 days overdue" / "Today" / "Thu 22 Oct" */
export function DueChip({ dueDate, isOverdue, done }: { dueDate: string | null; isOverdue: boolean; done?: boolean }) {
  if (!dueDate) return <span className="wd-due" data-kind="none">No due date</span>;
  const due = parseDateInput(dueDate)!;
  const days = Math.round((parseDateInput(todayInput())!.getTime() - due.getTime()) / 86_400_000);
  if (isOverdue && !done) {
    return <span className="wd-due" data-kind="over">{days <= 1 ? '1 day overdue' : `${days} days overdue`}</span>;
  }
  if (days === 0 && !done) return <span className="wd-due" data-kind="today">Today</span>;
  const label = Math.abs(days) < 180 ? weekdayFmt.format(due) : formatDate(dueDate);
  return <span className="wd-due" data-kind="later">{label}</span>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <Center py={60} role="status">
      <Stack align="center" gap="sm">
        <Loader size="md" color="gray" />
        <Text c="dimmed">{label}</Text>
      </Stack>
    </Center>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Stack align="center" gap={6} py={56} px="md" ta="center">
      <div className="wd-h3" style={{ margin: 0 }}>
        {title}
      </div>
      {children && <Text c="dimmed">{children}</Text>}
    </Stack>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert color="red" variant="light" radius="lg" icon={<AlertCircle size={18} />}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm">{message}</Text>
        {onRetry && (
          <Button size="xs" className="wd-soft" onClick={onRetry}>
            Retry
          </Button>
        )}
      </Group>
    </Alert>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  count?: number;
  /** Blue full stop after the title */
  period?: boolean;
}

export function PageHeader({ title, subtitle, actions, eyebrow, count, period }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-end" gap="lg" wrap="wrap">
      <div style={{ flex: '1 1 420px', maxWidth: 760 }}>
        {eyebrow && <div className="wd-eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>}
        <h1 className="wd-title">
          {title}
          {period && <span className="wd-period">.</span>}
          {count !== undefined && <sup>{count}</sup>}
        </h1>
        {subtitle && <p className="wd-sub">{subtitle}</p>}
      </div>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

interface BezelProps {
  title?: ReactNode;
  count?: number;
  extra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  padding?: CSSProperties['padding'];
  className?: string;
  style?: CSSProperties;
}

/** Warm-gray frame around a white card. */
export function Bezel({ title, count, extra, footer, children, padding, className, style }: BezelProps) {
  return (
    <section className={`wd-bezel ${className ?? ''}`} style={style}>
      {(title || extra) && (
        <div className="wd-bezel-head">
          {title && (
            <h2 className="wd-h2">
              {title}
              {count !== undefined && <sup>{count}</sup>}
            </h2>
          )}
          {extra}
        </div>
      )}
      <div className="wd-card" style={{ padding }}>
        {children}
      </div>
      {footer && <div className="wd-bezel-foot">{footer}</div>}
    </section>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}

/** Label wrapper for plain inputs (screens not yet moved to Mantine inputs). */
export function Field({ label, error, required, hint, full, children }: FieldProps) {
  return (
    <label className={`field ${full ? 'field-full' : ''} ${error ? 'field-error' : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="required"> *</span>}
      </span>
      {children}
      {error ? <span className="field-message">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <Group justify="space-between" px="md" py="sm" gap="sm" wrap="wrap">
      <Text c="dimmed">
        {from}–{to} of {total}
      </Text>
      <Group gap="sm">
        {onPageSize && (
          <Select
            size="xs"
            w={110}
            aria-label="Rows per page"
            allowDeselect={false}
            value={String(pageSize)}
            onChange={(v) => v && onPageSize(Number(v))}
            data={[10, 25, 50, 100].map((n) => ({ value: String(n), label: `${n} / page` }))}
          />
        )}
        <MantinePagination size="sm" radius="md" total={pages} value={page} onChange={onPage} withEdges siblings={1} />
      </Group>
    </Group>
  );
}
