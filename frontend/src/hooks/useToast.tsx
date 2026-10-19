import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { notifications } from '@mantine/notifications';

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => notifications.show({ message, color: 'teal', autoClose: 3500 }),
      error: (message) => notifications.show({ message, color: 'red', autoClose: 6000 }),
      info: (message) => notifications.show({ message, color: 'indigo', autoClose: 3500 }),
    }),
    [],
  );
  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
