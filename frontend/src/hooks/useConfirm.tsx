import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Text } from '@mantine/core';
import { Modal } from '../components/Modal';

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Promise-based confirmation dialog for destructive or significant actions. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Modal
          title={options.title}
          onClose={() => close(false)}
          size="sm"
          footer={
            <>
              <Button variant="default" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button color={options.danger ? 'red' : undefined} onClick={() => close(true)} data-autofocus>
                {options.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <Text component="div" c="dimmed">
            {options.message}
          </Text>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
