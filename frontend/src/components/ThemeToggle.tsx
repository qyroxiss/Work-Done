import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { Moon, Sun } from 'lucide-react';

/** Switches between light and dark mode (the default follows the system setting). */
export function ThemeToggle({ onCard = false }: { onCard?: boolean }) {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const next = scheme === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip label={`Switch to ${next} mode`}>
      <ActionIcon
        size={34}
        radius={10}
        onClick={() => setColorScheme(next)}
        aria-label={`Switch to ${next} mode`}
        className="wd-soft"
        style={onCard ? { background: 'var(--wd-card)', boxShadow: 'var(--wd-lift)', color: 'var(--mantine-color-text)' } : undefined}
      >
        {scheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </ActionIcon>
    </Tooltip>
  );
}
