import type { ReactNode } from 'react';
import { Group, Modal as MantineModal, Text } from '@mantine/core';

interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const WIDTH = { sm: 440, md: 600, lg: 860 };

export function Modal({ title, onClose, children, footer, size = 'md' }: ModalProps) {
  return (
    <MantineModal opened onClose={onClose} size={WIDTH[size]} padding="lg" title={<Text component="span" className="wd-h3" style={{ display: 'block', margin: 0, fontSize: 26 }}>{title}</Text>}>
      {children}
      {footer && (
        <Group justify="flex-end" gap="xs" mt="lg">
          {footer}
        </Group>
      )}
    </MantineModal>
  );
}
