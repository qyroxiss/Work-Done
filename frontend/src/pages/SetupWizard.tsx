import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Code, Group, List, PasswordInput, SimpleGrid, Stack, Stepper, Text, TextInput } from '@mantine/core';
import { CheckCircle2, Info } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { api, ApiError, errorMessage, setSetupKey } from '../services/api';

export interface SetupStatus {
  needsSetup: boolean;
  step: 'database' | 'admin' | 'done';
  /** This browser may run setup (server computer, or setup key entered) */
  isLocal: boolean;
  /** Request comes from the server computer itself (Windows options are offered) */
  onServerComputer?: boolean;
  setupKeyEnabled?: boolean;
  dbError?: string;
  environment?: {
    platform: string;
    computerName: string;
    lanAddresses: string[];
    port: number;
  };
}

interface TestResult {
  ok: boolean;
  error?: string;
  version?: string;
  database?: string;
  user?: string;
  canCreate?: boolean;
}

const STEPS = ['Database', 'Company', 'Finished'];

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="wd-h2" style={{ margin: 0 }}>
    {children}
  </h2>
);

const ErrorAlert = ({ children }: { children: ReactNode }) => (
  <Alert color="red" variant="light" radius="lg">
    {children}
  </Alert>
);

const InfoAlert = ({ children }: { children: ReactNode }) => (
  <Alert color="blue" variant="light" radius="lg" icon={<Info size={18} />}>
    {children}
  </Alert>
);

function DoneList({ items, check = true }: { items: string[]; check?: boolean }) {
  if (items.length === 0) return null;
  return (
    <List spacing={4} size="sm" center icon={check ? <CheckCircle2 size={16} color="#12A150" /> : undefined}>
      {items.map((l) => (
        <List.Item key={l}>{l}</List.Item>
      ))}
    </List>
  );
}

export function SetupWizard({ initial, onRefresh }: { initial: SetupStatus; onRefresh: () => Promise<SetupStatus> }) {
  const [status, setStatus] = useState(initial);
  const [stepIndex, setStepIndex] = useState(initial.step === 'admin' ? 1 : 0);
  const [log, setLog] = useState<string[]>([]);

  const refresh = async () => {
    const s = await onRefresh();
    setStatus(s);
    return s;
  };

  if (!status.isLocal) {
    return (
      <SetupShell stepIndex={-1}>
        {status.setupKeyEnabled ? (
          <SetupKeyStep onDone={refresh} />
        ) : (
          <>
            <H2>Setup required</H2>
            <Text>
              Q-WorkDone has not been set up yet. For security, setup can only be done on the <strong>server computer</strong> itself: open{' '}
              <code>http://localhost:{status.environment?.port ?? 3000}</code> in a browser there.
            </Text>
          </>
        )}
      </SetupShell>
    );
  }

  return (
    <SetupShell stepIndex={stepIndex}>
      {stepIndex === 0 && (
        <DatabaseStep
          dbError={status.dbError}
          onDone={async (lines) => {
            setLog(lines);
            await refresh();
            setStepIndex(1);
          }}
        />
      )}
      {stepIndex === 1 && <AdminStep status={status} intro={log} onDone={() => setStepIndex(2)} />}
      {stepIndex === 2 && <FinishedStep status={status} />}
    </SetupShell>
  );
}

function SetupShell({ stepIndex, children }: { stepIndex: number; children: ReactNode }) {
  return (
    <AuthLayout eyebrow="First-time setup" title="Set up Q-WorkDone" subtitle="Connect a database and create your company. Everyone else just signs in." width={640} connected={false}>
      {stepIndex >= 0 && (
        <Stepper active={stepIndex} size="sm" color="dark" allowNextStepsSelect={false} mb="xs">
          {STEPS.map((s) => (
            <Stepper.Step key={s} label={s} />
          ))}
        </Stepper>
      )}
      {children}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- Setup key (from another computer)
function SetupKeyStep({ onDone }: { onDone: () => Promise<SetupStatus> }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSetupKey(key.trim());
    try {
      const s = await onDone();
      if (!s.isLocal) {
        setSetupKey(null);
        setError('That setup key is not correct.');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <H2>Enter the setup key</H2>
        <Text c="dimmed">Q-WorkDone has not been set up yet. Enter the setup key (the SETUP_KEY value in the server settings) to continue.</Text>
        {error && <ErrorAlert>{error}</ErrorAlert>}
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

// ---------------------------------------------------------------- Step 1: database
function DatabaseStep({ dbError, onDone }: { dbError?: string; onDone: (log: string[]) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(dbError ?? null);

  const testConnection = async () => {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      setTest(await api.post<TestResult>('/setup/test-connection', { url: url.trim() }));
    } catch (err) {
      setError(err instanceof ApiError && err.fields ? Object.values(err.fields).join(' ') : errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      const r = await api.post<{ log: string[] }>('/setup/database', { url: url.trim() });
      await onDone(r.log);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={save}>
      <Stack gap="md">
        <H2>Connect the database</H2>
        <Text c="dimmed">
          Q-WorkDone keeps its data in PostgreSQL (version 14 or newer). Paste the connection string of an empty database; the app creates its own tables.
        </Text>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <PasswordInput
          label="Connection string"
          required
          placeholder="postgres://user:password@host:5432/database"
          classNames={{ input: 'wd-mono' }}
          value={url}
          onChange={(e) => {
            setUrl(e.currentTarget.value);
            setTest(null);
          }}
          autoComplete="off"
          data-autofocus
        />
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            On this computer: <Code>postgres://USER:PASSWORD@localhost:5432/workdone</Code>
          </Text>
          <Text size="xs" c="dimmed">
            Neon (Vercel): copy the connection string from the Neon dashboard; it ends with <Code>?sslmode=require</Code>.
          </Text>
          <Text size="xs" c="dimmed">
            Special characters in the password must be URL-encoded, for example <Code>@</Code> as <Code>%40</Code>.
          </Text>
        </Stack>

        {test && !test.ok && <ErrorAlert>{test.error}</ErrorAlert>}
        {test?.ok && (
          <Alert color={test.canCreate ? 'teal' : 'red'} variant="light" radius="lg">
            Connected to <strong>{test.database}</strong> as <strong>{test.user}</strong>: {test.version}
            {!test.canCreate && <div>This user may not create tables in this database. Use the database owner.</div>}
          </Alert>
        )}

        <Group justify="flex-end" gap="xs">
          <Button className="wd-soft" onClick={testConnection} loading={busy === 'test'} disabled={busy === 'save' || !url.trim()}>
            Test connection
          </Button>
          <Button type="submit" className="wd-ink" loading={busy === 'save'} disabled={busy === 'test' || !url.trim() || (test !== null && (!test.ok || !test.canCreate))}>
            Connect
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------- Step 2: company and administrator
interface CompanyValue {
  companyName: string;
  clientId: string;
}

function validateCompany(v: CompanyValue): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!v.companyName.trim()) errs.companyName = 'Company name is required';
  if (!/^[A-Za-z0-9._-]{2,30}$/.test(v.clientId.trim())) errs.clientId = '2-30 characters: letters, numbers, dot, dash, underscore';
  return errs;
}

function AdminStep({ status, intro, onDone }: { status: SetupStatus; intro: string[]; onDone: () => void }) {
  const windowsServer = status.environment?.platform === 'win32' && Boolean(status.onServerComputer);
  const [company, setCompany] = useState<CompanyValue>({ companyName: '', clientId: '' });
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sample, setSample] = useState(false);
  const [firewall, setFirewall] = useState(windowsServer);
  const [autostart, setAutostart] = useState(windowsServer);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = validateCompany(company);
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) errs.username = 'At least 3 characters: letters, numbers, dot, dash, underscore';
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) errs.password = 'At least 8 characters with letters and numbers';
    if (confirm !== password) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;

    setBusy(true);
    const done: string[] = [];
    try {
      // Windows options first (they are only allowed while setup is still open)
      for (const [enabled, action] of [
        [windowsServer && firewall, 'firewall'],
        [windowsServer && autostart, 'autostart'],
      ] as const) {
        if (!enabled) continue;
        try {
          const r = await api.post<{ message: string }>('/setup/system-action', { action });
          done.push(r.message);
        } catch (err) {
          done.push(`Skipped ${action}: ${errorMessage(err)}`);
        }
      }
      const r = await api.post<{ log: string[] }>('/setup/admin', { ...company, username: username.trim(), password, loadSampleData: sample });
      setNotes([...done, ...r.log]);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
      setNotes(done);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        <DoneList items={intro} />
        <H2>Your company</H2>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput
            label="Company name"
            required
            error={errors.companyName}
            value={company.companyName}
            onChange={(e) => setCompany({ ...company, companyName: e.currentTarget.value })}
            maxLength={150}
          />
          <TextInput
            label="Client ID"
            required
            error={errors.clientId}
            description={errors.clientId ? undefined : 'Short code everyone types at sign-in, e.g. ACME'}
            classNames={{ input: 'wd-mono' }}
            value={company.clientId}
            onChange={(e) => setCompany({ ...company, clientId: e.currentTarget.value.toUpperCase().trim() })}
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
          />
        </SimpleGrid>
        <H2>Administrator account</H2>
        <Text c="dimmed" mt={-8}>
          This account manages users, employees and products. Keep the password safe.
        </Text>
        <TextInput label="Username" required error={errors.username} value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoComplete="off" />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <PasswordInput label="Password" required error={errors.password} value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="new-password" />
          <PasswordInput label="Confirm password" required error={errors.confirm} value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} autoComplete="new-password" />
        </SimpleGrid>
        <Checkbox checked={sample} onChange={(e) => setSample(e.currentTarget.checked)} label="Add sample employees and products (for trying out the app, not for real use)" />
        {windowsServer && (
          <Stack gap={8}>
            <Text fw={500} size="sm">
              Server options (Windows administrator prompt)
            </Text>
            <Checkbox
              checked={firewall}
              onChange={(e) => setFirewall(e.currentTarget.checked)}
              label="Allow other office computers to open Q-WorkDone (Windows Firewall, local network only)"
            />
            <Checkbox checked={autostart} onChange={(e) => setAutostart(e.currentTarget.checked)} label="Start Q-WorkDone automatically when this computer starts" />
          </Stack>
        )}
        <DoneList items={notes} check={false} />
        <Group justify="flex-end">
          <Button type="submit" className="wd-ink" loading={busy}>
            Finish setup
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------- Step 3
function FinishedStep({ status }: { status: SetupStatus }) {
  const env = status.environment;
  return (
    <Stack gap="md">
      <H2>Q-WorkDone is ready</H2>
      <Text>Sign in with your Client ID and the administrator account you just created. Then:</Text>
      <List type="ordered" spacing={4}>
        <List.Item>
          Add <strong>Employees</strong> (and product groups and products)
        </List.Item>
        <List.Item>
          Create <strong>Users</strong>: a sign-in for each employee and manager
        </List.Item>
        <List.Item>
          Use <strong>New work</strong> to create and assign work
        </List.Item>
      </List>
      {status.onServerComputer && env && env.lanAddresses.length > 0 && (
        <InfoAlert>
          Other office computers can open Q-WorkDone at:
          {env.lanAddresses.map((ip) => (
            <div key={ip} className="wd-mono" style={{ fontWeight: 600 }}>
              http://{ip}:{env.port}
            </div>
          ))}
          <Text size="xs" c="dimmed">
            or http://{env.computerName}:{env.port}
          </Text>
        </InfoAlert>
      )}
      <Text size="xs" c="dimmed">
        To host more companies, open <code>/clients</code> on the server computer (or with the setup key). Each company gets its own Client ID and its own
        set of tables.
      </Text>
      <Group justify="flex-end">
        <Button className="wd-ink" onClick={() => window.location.replace('/')}>
          Go to sign in
        </Button>
      </Group>
    </Stack>
  );
}
