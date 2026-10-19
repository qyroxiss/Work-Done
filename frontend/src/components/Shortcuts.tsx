import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Group, Stack, Text } from '@mantine/core';
import { useAuth } from '../hooks/useAuth';
import { Modal } from './Modal';

interface Shortcut {
  keys: string[];
  label: string;
  managers?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['/'], label: 'Search on this page' },
  { keys: ['N'], label: 'New work', managers: true },
  { keys: ['G', 'D'], label: 'Go to Dashboard' },
  { keys: ['G', 'W'], label: 'Go to Work' },
  { keys: ['G', 'C'], label: 'Go to Chat' },
  { keys: ['G', 'R'], label: 'Go to Reports', managers: true },
  { keys: ['G', 'P'], label: 'Go to Repeating work', managers: true },
  { keys: ['Esc'], label: 'Close a panel or dialog' },
  { keys: ['?'], label: 'Show this list' },
];

const GO: Record<string, { to: string; managers?: boolean }> = {
  d: { to: '/' },
  w: { to: '/work' },
  c: { to: '/chat' },
  r: { to: '/reports', managers: true },
  p: { to: '/recurring', managers: true },
};

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Keyboard shortcuts for the whole app; "?" lists them. */
export function Shortcuts() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isManager = hasRole('Admin', 'Manager');
  const [help, setHelp] = useState(false);
  const pendingG = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = e.key.toLowerCase();
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        const target = GO[key];
        if (target && (!target.managers || isManager)) {
          e.preventDefault();
          navigate(target.to);
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = Date.now();
      } else if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('main input[type="search"]');
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      } else if (key === 'n' && isManager) {
        e.preventDefault();
        navigate('/work/new');
      } else if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, isManager]);

  if (!help) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)} size="sm">
      <Stack gap={10}>
        {SHORTCUTS.filter((s) => !s.managers || isManager).map((s) => (
          <Group key={s.label} justify="space-between" wrap="nowrap">
            <Text>{s.label}</Text>
            <Group gap={4} wrap="nowrap">
              {s.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && (
                    <Text span c="dimmed" size="xs" mr={4}>
                      then
                    </Text>
                  )}
                  <kbd className="wd-kbd">{k}</kbd>
                </span>
              ))}
            </Group>
          </Group>
        ))}
      </Stack>
    </Modal>
  );
}
