import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionIcon, Button, Group, Indicator, Popover, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { AlarmClock, AtSign, Bell, CalendarClock, CircleDot, MessageSquareText, Paperclip, UserPlus } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import type { AppNotification, NotificationKind } from '../types';
import { relativeTime } from '../utils/format';

const ICON: Record<NotificationKind, typeof Bell> = {
  Assigned: UserPlus,
  Created: UserPlus,
  Status: CircleDot,
  Note: MessageSquareText,
  Mention: AtSign,
  Attachment: Paperclip,
  DueToday: CalendarClock,
  Overdue: AlarmClock,
};

const TONE: Partial<Record<NotificationKind, string>> = {
  Overdue: 'var(--wd-danger)',
  DueToday: 'var(--wd-warn)',
  Mention: 'var(--wd-accent)',
};

/** Bell in the top bar: unread count, recent notifications, live updates. */
export function NotificationBell() {
  const { subscribe } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [more, setMore] = useState(false);

  const refreshCount = useCallback(() => {
    api
      .get<{ unread: number }>('/notifications/unread')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);

  const loadList = useCallback(async (before?: number) => {
    const r = await api.get<{ items: AppNotification[]; unread: number }>(`/notifications?limit=30${before ? `&before=${before}` : ''}`);
    setItems((prev) => (before && prev ? [...prev, ...r.items] : r.items));
    setUnread(r.unread);
    setMore(r.items.length === 30);
  }, []);

  useEffect(() => {
    refreshCount();
    const onFocus = () => document.visibilityState === 'visible' && refreshCount();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refreshCount]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'notification') {
          setUnread((n) => n + 1);
          setItems((prev) => (prev ? [event.notification, ...prev] : prev));
          toast.info(event.notification.message);
        } else if (event.type === 'notifications-read') {
          setUnread(event.unread);
          if (event.unread === 0) setItems((prev) => prev?.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })) ?? prev);
        }
      }),
    [subscribe, toast],
  );

  useEffect(() => {
    if (open) void loadList().catch(() => undefined);
  }, [open, loadList]);

  const markAll = async () => {
    const r = await api.post<{ unread: number }>('/notifications/read', { all: true });
    setUnread(r.unread);
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev);
  };

  const openItem = (n: AppNotification) => {
    setOpen(false);
    if (!n.readAt) {
      setItems((prev) => prev?.map((x) => (x.notificationId === n.notificationId ? { ...x, readAt: new Date().toISOString() } : x)) ?? prev);
      api
        .post<{ unread: number }>('/notifications/read', { ids: [n.notificationId] })
        .then((r) => setUnread(r.unread))
        .catch(() => undefined);
    }
    if (n.workId) navigate(`/work?id=${n.workId}`);
  };

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" width={380} offset={10} radius="lg" shadow="lg" withinPortal>
      <Popover.Target>
        <Tooltip label="Notifications" disabled={open}>
          <Indicator label={unread > 99 ? '99+' : unread} size={16} offset={5} disabled={unread === 0} color="blue">
            <ActionIcon
              variant="subtle"
              color="gray"
              size={34}
              radius={10}
              onClick={() => setOpen((o) => !o)}
              aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <Bell size={17} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py={12} style={{ borderBottom: '1px solid var(--wd-line)' }}>
          <Text fw={600}>Notifications</Text>
          {unread > 0 && (
            <Button variant="subtle" size="compact-xs" color="gray" onClick={markAll}>
              Mark all read
            </Button>
          )}
        </Group>
        <ScrollArea.Autosize mah={440} type="auto">
          {items === null ? (
            <Text c="dimmed" ta="center" py="xl" size="sm">
              Loading…
            </Text>
          ) : items.length === 0 ? (
            <Stack align="center" gap={4} py={36} px="md">
              <Bell size={22} color="var(--wd-muted)" />
              <Text c="dimmed" size="sm" ta="center">
                Nothing yet. You will hear about work assigned to you, mentions and due dates here.
              </Text>
            </Stack>
          ) : (
            <Stack gap={0} p={6}>
              {items.map((n) => {
                const Icon = ICON[n.kind] ?? Bell;
                return (
                  <UnstyledButton key={n.notificationId} className="wd-notice" data-unread={!n.readAt} onClick={() => openItem(n)}>
                    <span className="wd-notice-icon" style={{ '--tone': TONE[n.kind] ?? 'var(--mantine-color-text)' } as CSSProperties}>
                      <Icon size={15} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" lh={1.4} style={{ overflowWrap: 'anywhere' }}>
                        {n.message}
                      </Text>
                      <Text size="xs" c="dimmed" mt={2}>
                        {relativeTime(n.createdAt)}
                      </Text>
                    </span>
                    {!n.readAt && <span className="wd-notice-dot" aria-label="Unread" />}
                  </UnstyledButton>
                );
              })}
              {more && (
                <Button variant="subtle" color="gray" size="xs" m={6} onClick={() => void loadList(items[items.length - 1]?.notificationId)}>
                  Show older
                </Button>
              )}
            </Stack>
          )}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
