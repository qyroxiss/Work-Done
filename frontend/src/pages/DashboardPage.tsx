import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Box, Button, Group, Stack, Text } from '@mantine/core';
import { ArrowRight, Info } from 'lucide-react';
import { Bezel, DueChip, EmptyState, ErrorBanner, PageHeader, PersonAvatar, PriorityMark, Spinner, STATUS_DOT } from '../components/common';
import { useAuth } from '../hooks/useAuth';
import { api, errorMessage } from '../services/api';
import { WORK_STATUSES, type ActivityEntry, type DashboardData } from '../types';
import { relativeTime } from '../utils/format';

interface EmployeeLoad {
  employeeId: number;
  employeeName: string;
  pending: number;
  inProgress: number;
  onHold: number;
  reopened: number;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const isManager = hasRole('Admin', 'Manager');
  const [data, setData] = useState<DashboardData | null>(null);
  const [team, setTeam] = useState<{ name: string; open: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<DashboardData>('/dashboard'));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Open items per employee, from the existing employee-wise report
  useEffect(() => {
    if (!isManager) return;
    api
      .get<{ rows: EmployeeLoad[] }>('/reports/employee-work')
      .then((r) =>
        setTeam(
          r.rows
            .map((x) => ({ name: x.employeeName, open: x.pending + x.inProgress + x.onHold + x.reopened }))
            .filter((x) => x.open > 0)
            .sort((a, b) => b.open - a.open)
            .slice(0, 6),
        ),
      )
      .catch(() => setTeam([]));
  }, [isManager]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const c = data.statusCounts;
  const openCount = c.Pending + c['In Progress'] + c['On Hold'] + c.Reopened;
  const total = WORK_STATUSES.reduce((sum, s) => sum + c[s], 0);
  const firstName = (user?.employeeName ?? user?.username ?? '').split(' ')[0];
  const maxLoad = Math.max(1, ...(team ?? []).map((t) => t.open));

  const summary = [
    `${openCount} open`,
    data.overdue > 0 ? <span key="o" style={{ color: 'var(--wd-danger)' }}>{data.overdue} overdue</span> : null,
    isManager && c.Completed > 0 ? `${c.Completed} waiting for your review` : null,
  ].filter(Boolean);

  return (
    <Stack gap={28}>
      <PageHeader
        eyebrow={dayFmt.format(new Date())}
        title={`${greeting()}, ${firstName}`}
        period
        subtitle={summary.map((s, i) => (
          <span key={i}>
            {i > 0 && (i === summary.length - 1 ? ' and ' : ', ')}
            {s}
          </span>
        ))}
        actions={
          <>
            {isManager && (
              <Button component={Link} to="/reports" className="wd-soft" h={40}>
                Open reports
              </Button>
            )}
            <Button component={Link} to="/work" className="wd-soft" h={40} rightSection={<ArrowRight size={14} />}>
              All work
            </Button>
          </>
        }
      />

      {!isManager && !user?.employeeId && (
        <Alert color="blue" variant="light" radius="lg" icon={<Info size={18} />}>
          Your account is not linked to an employee record, so no work can be assigned to you.
        </Alert>
      )}

      <section aria-label="Key numbers" className="wd-bezel">
        <div className="wd-card wd-kpis">
          <Kpi label="Open work" value={openCount} note="Pending, in progress, on hold" to="/work" />
          <Kpi label="Overdue" value={data.overdue} note="Past their due date" to="/work?overdue=true" danger={data.overdue > 0} />
          <Kpi label="Due today" value={data.dueToday} note={new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date())} />
          <Kpi label="Next 7 days" value={data.dueThisWeek} note="Due this week" />
          {isManager ? (
            <>
              <Kpi label="Awaiting review" value={c.Completed} note="Completed, not closed" to="/work?status=Completed" />
              <Kpi label="Unassigned" value={data.unassigned} note="Nobody on it yet" to="/work?assignment=unassigned" />
            </>
          ) : (
            <Kpi label="Done" value={c.Completed + c.Closed} note="Completed or closed" />
          )}
        </div>
      </section>

      <Group align="flex-start" gap={20} wrap="wrap">
        <Stack gap={20} style={{ flex: '2 1 560px', minWidth: 0 }}>
          <Bezel
            title="Needs attention"
            count={data.upcoming.length}
            padding={6}
            footer={
              <Link to="/work" style={{ color: 'inherit', textDecoration: 'none' }}>
                View all open work →
              </Link>
            }
          >
            {data.upcoming.length === 0 ? (
              <EmptyState title="Nothing due">No open work with a due date.</EmptyState>
            ) : (
              data.upcoming.map((w) => (
                <Link key={w.workId} to={`/work?id=${w.workId}`} className="wd-row">
                  <Box w={18} style={{ display: 'inline-flex', justifyContent: 'center' }}>
                    <PriorityMark priority={w.priority} label={false} />
                  </Box>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={500} fz={15} truncate>
                      {w.title}
                    </Text>
                    <Text size="xs" c="dimmed" mt={3} truncate>
                      <span className="wd-mono">{w.workNo}</span> · {w.assignees.map((a) => a.employeeName).join(', ') || 'Unassigned'}
                    </Text>
                  </Box>
                  <DueChip dueDate={w.dueDate} isOverdue={w.isOverdue} />
                </Link>
              ))
            )}
          </Bezel>

          <Bezel title="Recent activity" padding="8px 20px">
            {data.recentActivity.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              data.recentActivity.map((a, i) => (
                <Link
                  key={a.historyId}
                  to={`/work?id=${a.workId}`}
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '12px 0',
                    alignItems: 'flex-start',
                    color: 'inherit',
                    textDecoration: 'none',
                    boxShadow: i > 0 ? 'inset 0 1px 0 var(--wd-line)' : undefined,
                  }}
                >
                  <PersonAvatar name={a.changedByName} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text lh={1.5}>
                      <Text span fw={600}>
                        {a.changedByName}
                      </Text>{' '}
                      <Text span c="dimmed">
                        {describeActivity(a)}
                      </Text>{' '}
                      <span className="wd-mono">{a.workNo}</span>
                    </Text>
                    <Text size="xs" c="dimmed" mt={2} truncate>
                      {a.notes && a.entryType !== 'Created' && a.entryType !== 'Edit' ? `“${a.notes}”` : a.title}
                    </Text>
                  </Box>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    {relativeTime(a.changedAt)}
                  </Text>
                </Link>
              ))
            )}
          </Bezel>
        </Stack>

        <Stack gap={20} style={{ flex: '1 1 300px', minWidth: 0 }}>
          <Bezel title="By status" extra={<Text size="xs" c="dimmed">{total} items</Text>} padding="18px 20px">
            <div style={{ display: 'flex', height: 36, gap: 3 }}>
              {total === 0 ? (
                <span style={{ flex: 1, background: 'var(--wd-surface)', borderRadius: 8 }} />
              ) : (
                WORK_STATUSES.filter((s) => c[s] > 0).map((s) => (
                  <span key={s} title={`${s}: ${c[s]}`} style={{ flex: c[s], background: STATUS_DOT[s], borderRadius: 8 }} />
                ))
              )}
            </div>
            <Stack gap={11} mt={18}>
              {WORK_STATUSES.map((s) => (
                <Group key={s} gap={10} wrap="nowrap">
                  <span className="wd-dot" style={{ '--dot': STATUS_DOT[s] } as CSSProperties} />
                  <Text c="dimmed" style={{ flex: 1 }}>
                    {s}
                  </Text>
                  <span className="wd-serif-num" style={{ fontSize: 22 }}>
                    {c[s]}
                  </span>
                </Group>
              ))}
            </Stack>
          </Bezel>

          {isManager && (
            <Bezel title="Team" extra={<Text size="xs" c="dimmed">Open items each</Text>} padding="16px 20px">
              {team === null ? (
                <Spinner />
              ) : team.length === 0 ? (
                <Text c="dimmed" py="md">
                  Nobody has open work.
                </Text>
              ) : (
                <Stack gap={14}>
                  {team.map((t) => (
                    <Group key={t.name} gap={12} wrap="nowrap">
                      <PersonAvatar name={t.name} size={28} />
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" truncate>
                          {t.name}
                        </Text>
                        <div style={{ height: 4, background: 'var(--wd-surface)', borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(t.open / maxLoad) * 100}%`, background: 'var(--mantine-color-text)', borderRadius: 999 }} />
                        </div>
                      </Box>
                      <span className="wd-serif-num" style={{ fontSize: 22, minWidth: 16, textAlign: 'right' }}>
                        {t.open}
                      </span>
                    </Group>
                  ))}
                </Stack>
              )}
            </Bezel>
          )}
        </Stack>
      </Group>
    </Stack>
  );
}

function describeActivity(a: ActivityEntry): string {
  switch (a.entryType) {
    case 'Created':
      return 'created';
    case 'StatusChange':
      return `moved to ${a.newStatus}`;
    case 'Assignment':
      return 'updated assignment of';
    case 'Edit':
      return 'edited';
    default:
      return 'added a note on';
  }
}

function Kpi({ label, value, note, to, danger }: { label: string; value: number; note: string; to?: string; danger?: boolean }) {
  const body = (
    <>
      <Text c="dimmed">{label}</Text>
      <span className="wd-kpi-value" style={danger ? { color: 'var(--wd-danger)' } : undefined}>
        {value}
      </span>
      <Text size="xs" c="dimmed">
        {note}
      </Text>
    </>
  );
  return to ? (
    <Link to={to} className="wd-kpi">
      {body}
    </Link>
  ) : (
    <div className="wd-kpi">{body}</div>
  );
}
