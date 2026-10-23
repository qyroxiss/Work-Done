import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Divider, Group, List, PasswordInput, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { CheckCircle2 } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { ActiveBadge, Spinner } from '../components/common';
import { api, ApiError, errorMessage, setSetupKey } from '../services/api';
import { formatDateTime } from '../utils/format';

interface Client {
  clientId: string;
  companyName: string;
  schemaName: string;
  isActive: boolean;
  createdAt: string;
}

const EMPTY_FORM = { companyName: '', clientId: '', username: 'admin', email: '', password: '', confirm: '' };

/**
 * Client companies hosted by this installation, each with its own tables.
 * Available on the server computer itself, or from anywhere with the setup key (SETUP_KEY).
 */
export function ClientsPage() {
  const [items, setItems] = useState<Client[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.get<{ items: Client[] }>('/setup/clients')).items);
      setLoadError(null);
      setNeedsKey(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && /setup key/i.test(err.message)) setNeedsKey(true);
      else setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (c: Client) => {
    setBusyId(c.clientId);
    setRowError(null);
    try {
      await api.patch(`/setup/clients/${encodeURIComponent(c.clientId)}`, { isActive: !c.isActive });
      await load();
    } catch (err) {
      setRowError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AuthLayout
      eyebrow="Service provider"
      title="Client companies"
      subtitle="Each client signs in with its own Client ID; its data is kept separate from every other client."
      width={860}
      note={
        <Button variant="subtle" color="gray" size="compact-sm" onClick={() => window.location.replace('/')}>
          Go to sign in
        </Button>
      }
    >
      {needsKey ? (
        <SetupKeyForm onSaved={load} />
      ) : loadError ? (
        <Alert color="red" variant="light" radius="lg">
          {loadError}
        </Alert>
      ) : !items ? (
        <Spinner label="Loading clients…" />
      ) : (
        <>
          {rowError && (
            <Alert color="red" variant="light" radius="lg">
              {rowError}
            </Alert>
          )}
          <Table.ScrollContainer minWidth={620}>
            <Table verticalSpacing={12} className="wd-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Company</Table.Th>
                  <Table.Th>Data</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((c) => (
                  <Table.Tr key={c.clientId}>
                    <Table.Td>
                      <Text fw={500}>{c.companyName}</Text>
                      <Text className="wd-mono" size="xs" c="dimmed">
                        {c.clientId}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text className="wd-mono" size="xs" c="dimmed" title="PostgreSQL schema">
                        {c.schemaName}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {formatDateTime(c.createdAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <ActiveBadge active={c.isActive} />
                    </Table.Td>
                    <Table.Td ta="right">
                      <Button
                        size="xs"
                        className="wd-soft"
                        disabled={busyId !== null && busyId !== c.clientId}
                        loading={busyId === c.clientId}
                        onClick={() => void toggle(c)}
                      >
                        {c.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Divider my="xs" />
          <AddClientForm onAdded={load} />
        </>
      )}
    </AuthLayout>
  );
}

function SetupKeyForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setSetupKey(key.trim());
        await onSaved();
        setBusy(false);
      }}
    >
      <Stack gap="md">
        <Text c="dimmed">Enter the setup key (the SETUP_KEY value in the server settings) to manage client companies from this computer.</Text>
        <PasswordInput label="Setup key" required value={key} onChange={(e) => setKey(e.currentTarget.value)} autoComplete="off" data-autofocus />
        <Group justify="flex-end">
          <Button type="submit" className="wd-ink" loading={busy} disabled={!key.trim()}>
            Continue
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function AddClientForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.companyName.trim()) errs.companyName = 'Company name is required';
    if (!/^[A-Za-z0-9._-]{2,30}$/.test(form.clientId)) errs.clientId = '2-30 characters: letters, numbers, dot, dash, underscore';
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(form.username)) errs.username = 'At least 3 characters: letters, numbers, dot, dash, underscore';
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password))
      errs.password = 'At least 8 characters with letters and numbers';
    if (form.confirm !== form.password) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    setError(null);
    setLog([]);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const r = await api.post<{ log: string[] }>('/setup/clients', {
        companyName: form.companyName.trim(),
        clientId: form.clientId,
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setLog(r.log);
      setForm(EMPTY_FORM);
      await onAdded();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        <h2 className="wd-h2" style={{ margin: 0 }}>
          Add a client
        </h2>
        {error && (
          <Alert color="red" variant="light" radius="lg">
            {error}
          </Alert>
        )}
        {log.length > 0 && (
          <List spacing={4} size="sm" icon={<CheckCircle2 size={16} color="#12A150" />} center>
            {log.map((l) => (
              <List.Item key={l}>{l}</List.Item>
            ))}
          </List>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput label="Company name" required error={errors.companyName} value={form.companyName} onChange={(e) => set('companyName')(e.currentTarget.value)} maxLength={150} />
          <TextInput
            label="Client ID"
            required
            error={errors.clientId}
            description={errors.clientId ? undefined : 'Typed at sign-in, e.g. ACME. Cannot be changed later.'}
            classNames={{ input: 'wd-mono' }}
            value={form.clientId}
            onChange={(e) => set('clientId')(e.currentTarget.value.toUpperCase().trim())}
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
          />
          <TextInput label="Administrator username" required error={errors.username} value={form.username} onChange={(e) => set('username')(e.currentTarget.value)} autoComplete="off" maxLength={50} />
          <TextInput label="Administrator email" type="email" error={errors.email} value={form.email} onChange={(e) => set('email')(e.currentTarget.value)} autoComplete="off" maxLength={150} />
          <PasswordInput
            label="Temporary password"
            required
            error={errors.password}
            description={errors.password ? undefined : 'Must be changed at first sign-in'}
            value={form.password}
            onChange={(e) => set('password')(e.currentTarget.value)}
            autoComplete="new-password"
          />
          <PasswordInput label="Confirm password" required error={errors.confirm} value={form.confirm} onChange={(e) => set('confirm')(e.currentTarget.value)} autoComplete="new-password" />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" className="wd-ink" loading={busy}>
            Create client
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
