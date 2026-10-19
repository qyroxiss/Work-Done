import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from './services/api';
import type { SetupStatus } from './pages/SetupWizard';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button } from '@mantine/core';
import { AuthLayout } from './components/AuthLayout';
import { ChangePasswordForm } from './components/ChangePasswordForm';
import { ErrorBanner, Spinner } from './components/common';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ConfirmProvider } from './hooks/useConfirm';
import { ToastProvider } from './hooks/useToast';
import { ChatProvider } from './hooks/useChat';
import { LoginPage } from './pages/LoginPage';
import type { Role } from './types';

// Each screen is its own chunk, downloaded the first time it is opened
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const SetupWizard = lazy(() => import('./pages/SetupWizard').then((m) => ({ default: m.SetupWizard })));
const ChatPage = page(() => import('./pages/ChatPage'), 'ChatPage');
const ClientsPage = page(() => import('./pages/ClientsPage'), 'ClientsPage');
const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const EmployeesPage = page(() => import('./pages/EmployeesPage'), 'EmployeesPage');
const ProductGroupsPage = page(() => import('./pages/ProductGroupsPage'), 'ProductGroupsPage');
const ProductsPage = page(() => import('./pages/ProductsPage'), 'ProductsPage');
const ReportsPage = page(() => import('./pages/ReportsPage'), 'ReportsPage');
const RecurringPage = page(() => import('./pages/RecurringPage'), 'RecurringPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const UsersPage = page(() => import('./pages/UsersPage'), 'UsersPage');
const WorkFormPage = page(() => import('./pages/WorkFormPage'), 'WorkFormPage');
const WorkGridPage = page(() => import('./pages/WorkGridPage'), 'WorkGridPage');

/** UI-level guard only — the API enforces the same permissions independently. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <ErrorBanner message="You do not have permission to view this page." />;
  return <>{children}</>;
}

function ForcedPasswordChange() {
  const { logout } = useAuth();
  return (
    <AuthLayout
      eyebrow="One more step"
      title="Set a new password"
      subtitle="For security, choose your own password before continuing."
      note={
        <Button variant="subtle" color="gray" size="xs" onClick={() => void logout()}>
          Log out instead
        </Button>
      }
    >
      <ChangePasswordForm fullWidth />
    </AuthLayout>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Server-computer page for managing client companies (no sign-in; the API only answers localhost)
  if (location.pathname === '/clients')
    return (
      <Suspense fallback={<Spinner />}>
        <ClientsPage />
      </Suspense>
    );
  if (loading) return <Spinner label="Starting Q-WorkDone…" />;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ForcedPasswordChange />;

  const managers: Role[] = ['Admin', 'Manager'];
  const admins: Role[] = ['Admin'];

  return (
    <ChatProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="work" element={<WorkGridPage />} />
          <Route path="work/new" element={<RequireRole roles={managers}><WorkFormPage /></RequireRole>} />
          <Route path="work/:id/edit" element={<RequireRole roles={managers}><WorkFormPage /></RequireRole>} />
          <Route path="recurring" element={<RequireRole roles={managers}><RecurringPage /></RequireRole>} />
          <Route path="employees"element={<RequireRole roles={managers}><EmployeesPage /></RequireRole>} />
          <Route path="product-groups" element={<RequireRole roles={admins}><ProductGroupsPage /></RequireRole>} />
          <Route path="products" element={<RequireRole roles={admins}><ProductsPage /></RequireRole>} />
          <Route path="reports" element={<RequireRole roles={managers}><ReportsPage /></RequireRole>} />
          <Route path="users" element={<RequireRole roles={admins}><UsersPage /></RequireRole>} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ChatProvider>
  );
}

/** Shows the first-run setup wizard until the server is configured. */
function SetupGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await api.get<SetupStatus>('/setup/status');
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  if (error) {
    return (
      <AuthLayout title="Cannot reach the server" subtitle="Check that the Q-WorkDone server computer is on." connected={false}>
        <ErrorBanner message={error} onRetry={() => window.location.reload()} />
      </AuthLayout>
    );
  }
  if (!status) return <Spinner label="Starting Q-WorkDone…" />;
  if (status.needsSetup)
    return (
      <Suspense fallback={<Spinner label="Starting Q-WorkDone…" />}>
        <SetupWizard initial={status} onRefresh={load} />
      </Suspense>
    );
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SetupGate>
          <AuthProvider>
            <ConfirmProvider>
              <AppRoutes />
            </ConfirmProvider>
          </AuthProvider>
        </SetupGate>
      </ToastProvider>
    </BrowserRouter>
  );
}
