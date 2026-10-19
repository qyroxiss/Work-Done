import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Group, Paper, Text, Textarea, UnstyledButton } from '@mantine/core';
import type { MentionableUser } from '../types';
import { PersonAvatar } from './common';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** People who may be mentioned (loaded by the caller) */
  people: MentionableUser[];
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Text box that suggests people after "@" and inserts "@username". Enter sends, Shift+Enter adds a line. */
export function MentionInput({ value, onChange, people, onSubmit, placeholder, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // "@pri" right before the caret -> query "pri"
  const match = /(^|\s)@([\w.-]*)$/.exec(value.slice(0, caret));
  const queryText = match ? match[2].toLowerCase() : null;
  const suggestions = useMemo(() => {
    if (queryText === null) return [];
    return people
      .filter((p) => p.username.toLowerCase().startsWith(queryText) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(queryText)))
      .slice(0, 6);
  }, [people, queryText]);
  const open = suggestions.length > 0 && dismissed !== `${caret}:${value}`;

  const pick = (p: MentionableUser) => {
    const start = caret - (match?.[2].length ?? 0) - 1;
    const next = `${value.slice(0, start)}@${p.username} ${value.slice(caret)}`;
    onChange(next);
    const pos = start + p.username.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
    setHighlight(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(suggestions[Math.min(highlight, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(`${caret}:${value}`);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      {open && (
        <Paper shadow="md" radius="lg" p={4} withBorder style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 5 }} role="listbox">
          {suggestions.map((p, i) => (
            <UnstyledButton
              key={p.userId}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onMouseEnter={() => setHighlight(i)}
              style={{ display: 'block', width: '100%', padding: '6px 8px', borderRadius: 10, background: i === highlight ? 'var(--wd-sel)' : undefined }}
            >
              <Group gap={10} wrap="nowrap">
                <PersonAvatar name={p.name} size={24} />
                <Text size="sm" fw={500} truncate>
                  {p.name}
                </Text>
                <Text size="xs" c="dimmed" className="wd-mono" ml="auto">
                  @{p.username}
                </Text>
              </Group>
            </UnstyledButton>
          ))}
        </Paper>
      )}
      <Textarea
        ref={ref}
        aria-label="Add a note"
        placeholder={placeholder}
        autosize
        minRows={1}
        maxRows={6}
        maxLength={2000}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          setHighlight(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        size="md"
        styles={{ input: { background: 'var(--wd-card)', borderRadius: 14 } }}
      />
    </div>
  );
}

/** Shows "@username" in notes in the accent color. */
export function withMentions(text: string): ReactNode[] {
  return text.split(/((?:^|(?<=\s))@[A-Za-z0-9._-]{3,50})/g).map((part, i) =>
    /^@[A-Za-z0-9._-]{3,50}$/.test(part) ? (
      <span key={i} className="wd-mention">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
