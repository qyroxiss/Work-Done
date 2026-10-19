import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Group,
  List,
  PasswordInput,
  Radio,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { CheckCircle2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { Spinner } from '../components/common';
import { api, ApiError, errorMessage } from '../services/api';

export interface SqlInstance {
  name: string;
  server: string;
  version: string;
  running: boolean;
  tcpEnabled: boolean;
  mixedMode: boolean;
}

export interface SetupStatus {
  needsSetup: boolean;
  step: 'database' | 'upgrade' | 'admin' | 'company' | 'done';
  isLocal: boolean;
  dbError?: string;
  environment?: {
    autoPlan: { instanceName: string; server: string; version: string; supported: boolean; fixes: string[] } | null;
    platform: string;
    computerName: string;
    lanAddresses: string[];
    port: number;
    instances: SqlInstance[];
    sqlBrowserRunning: boolean;
    sqlcmdAvailable: boolean;
  };
}

interface TestResult {
  ok: boolean;
  error?: string;
  version?: string;
  isSysadmin?: boolean;
  mixedMode?: boolean;
  databaseExists?: boolean;
}

const MANUAL_STEPS = ['SQL Server', 'Database', 'Administrator', 'Finished'];
const AUTO_STEPS = ['Database', 'Administrator', 'Finished'];

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
  // Index into MANUAL_STEPS; the automatic flow skips the "SQL Server" step
  const [stepIndex, setStepIndex] = useState(initial.step === 'admin' ? 2 : 1);
  const [manual, setManual] = useState(false);
  const [autoLog, setAutoLog] = useState<string[]>([]);

  if (!status.isLocal) {
    return (
      <SetupShell steps={AUTO_STEPS} stepIndex={-1}>
        <H2>Setup required</H2>
        <Text>
          Q-WorkDone has not been set up yet. For security, setup can only be done on the <strong>server computer</strong> itself: open{' '}
          <code>http://localhost:{status.environment?.port ?? 3000}</code> in a browser there.
        </Text>
      </SetupShell>
    );
  }

  const refresh = async () => {
    const s = await onRefresh();
    setStatus(s);
    return s;
  };

  // Database created by an older version of Q-WorkDone
  if (status.step === 'upgrade' || status.step === 'company') {
    return (
      <SetupShell steps={[]} stepIndex={-1}>
        {status.step === 'upgrade' ? (
          <UpgradeStep
            sqlcmdAvailable={!!status.environment?.sqlcmdAvailable}
            onDone={async () => {
              const s = await refresh();
              if (s.step === 'admin') setStepIndex(2);
            }}
          />
        ) : (
          <CompanyStep />
        )}
      </SetupShell>
    );
  }

  return (
    <SetupShell steps={manual ? MANUAL_STEPS : AUTO_STEPS} stepIndex={manual ? stepIndex : stepIndex - 1}>
      {stepIndex <= 1 && !manual && (
        <AutoDatabaseStep
          status={status}
          onInstalled={async (log) => {
            setAutoLog(log);
            await refresh();
            setStepIndex(2);
          }}
          onManual={() => {
            setManual(true);
            setStepIndex(0);
          }}
        />
      )}
      {stepIndex <= 1 && manual && (
        <DatabaseSteps status={status} stepIndex={stepIndex} setStepIndex={setStepIndex} refresh={refresh} onInstalled={() => setStepIndex(2)} />
      )}
      {stepIndex === 2 && <AdminStep status={status} intro={autoLog} onDone={() => setStepIndex(3)} />}
      {stepIndex === 3 && <FinishedStep status={status} />}
    </SetupShell>
  );
}

// ---------------------------------------------------------------- Automatic database setup
const FIX_LABEL: Record<string, string> = {
  start: 'start the SQL Server service',
  tcp: 'turn on TCP/IP',
  mixed: 'enable SQL logins',
};

function AutoDatabaseStep({
  status,
  onInstalled,
  onManual,
}: {
  status: SetupStatus;
  onInstalled: (log: string[]) => Promise<void>;
  onManual: () => void;
}) {
  const plan = status.environment?.autoPlan ?? null;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(
    plan ? null : 'No SQL Server was found on this computer. Install SQL Server (the free Express edition is fine) and start Q-WorkDone again, or use manual setup to connect to another server.',
  );
  const started = useRef(false);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.post<{ server: string; log: string[] }>('/setup/auto');
      await onInstalled(r.log);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }, [onInstalled]);

  // Start automatically as soon as the wizard opens (guarded against React StrictMode double effects)
  useEffect(() => {
    if (plan && !started.current) {
      started.current = true;
      void start();
    }
  }, [plan, start]);

  return (
    <Stack gap="md">
      <H2>Setting up the database</H2>
      {plan && (
        <Text>
          Q-WorkDone is setting up its database automatically on <strong>{plan.server}</strong> ({plan.version}) using your Windows account.
          {!plan.supported && (
            <Text span c="red.7">
              {' '}
              Note: this version is older than SQL Server 2019, which Q-WorkDone is designed for.
            </Text>
          )}
        </Text>
      )}
      {plan && plan.fixes.length > 0 && running && (
        <InfoAlert>
          Q-WorkDone needs to {plan.fixes.map((f) => FIX_LABEL[f]).join(', ')}. <strong>Windows will ask for administrator permission: click “Yes”.</strong>
        </InfoAlert>
      )}
      {running && <Spinner label="Creating the database, tables and login. This can take a minute." />}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {!running && (
        <Group justify="flex-end" gap="xs">
          <Button className="wd-soft" onClick={onManual}>
            Manual setup
          </Button>
          {plan && (
            <Button className="wd-ink" onClick={() => void start()}>
              Try again
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

function SetupShell({ steps, stepIndex, children }: { steps: string[]; stepIndex: number; children: ReactNode }) {
  return (
    <AuthLayout eyebrow="First-time setup" title="Set up Q-WorkDone" subtitle="Configure this server once. Everyone else just signs in." width={640} connected={false}>
      {stepIndex >= 0 && steps.length > 0 && (
        <Stepper active={stepIndex} size="sm" color="dark" allowNextStepsSelect={false} mb="xs">
          {steps.map((s) => (
            <Stepper.Step key={s} label={s} />
          ))}
        </Stepper>
      )}
      {children}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------- Steps 1 & 2
const dot = (color: string) => ({ '--dot': color }) as CSSProperties;

function Check({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <span className="wd-status">
      <span className="wd-dot" style={dot(ok ? '#12A150' : warn ? '#F59E0B' : '#F04438')} />
      {label}
    </span>
  );
}

function DatabaseSteps({
  status,
  stepIndex,
  setStepIndex,
  refresh,
  onInstalled,
}: {
  status: SetupStatus;
  stepIndex: number;
  setStepIndex: (i: number) => void;
  refresh: () => Promise<SetupStatus>;
  onInstalled: () => void;
}) {
  const env = status.environment;
  const instances = env?.instances ?? [];
  const firstUsable = instances.find((i) => i.running && i.tcpEnabled) ?? instances[0];

  const [server, setServer] = useState(firstUsable?.server ?? 'localhost');
  const [port, setPort] = useState('');
  const [authType, setAuthType] = useState<'windows' | 'sql'>(env?.sqlcmdAvailable ? 'windows' : 'sql');
  const [user, setUser] = useState('sa');
  const [password, setPassword] = useState('');
  const [encrypt, setEncrypt] = useState(true);
  const [trustCert, setTrustCert] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [database, setDatabase] = useState('WorkDoneDB');
  const [loadSample, setLoadSample] = useState(false);

  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const selected = instances.find((i) => i.server.toLowerCase() === server.toLowerCase());

  const body = () => ({
    server: server.trim(),
    port: port ? Number(port) : null,
    authType,
    user: authType === 'sql' ? user : undefined,
    password: authType === 'sql' ? password : undefined,
    encrypt,
    trustServerCertificate: trustCert,
    database: database.trim(),
  });

  const runAction = async (action: string, instanceName?: string) => {
    setBusy(action);
    setError(null);
    setActionMsg('Please approve the Windows administrator prompt on this computer…');
    try {
      const r = await api.post<{ message: string }>('/setup/system-action', { action, instanceName });
      setActionMsg(r.message);
      setTest(null);
      await refresh();
    } catch (err) {
      setActionMsg(null);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async () => {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      const r = await api.post<TestResult>('/setup/test-connection', body());
      setTest(r);
    } catch (err) {
      setError(err instanceof ApiError && err.fields ? Object.values(err.fields).join(' ') : errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const installNow = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('install');
    setError(null);
    try {
      const r = await api.post<{ log: string[] }>('/setup/install', { ...body(), loadSampleData: loadSample });
      setLog(r.log);
      await refresh();
      onInstalled();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const canContinue = test?.ok && test.mixedMode;

  if (stepIndex === 1) {
    return (
      <form onSubmit={installNow}>
        <Stack gap="md">
          <H2>Create the database</H2>
          <Text c="dimmed">
            Q-WorkDone will create the database and tables, and a separate login (<code>workdone_app</code>) with a random password that has only read/write
            access. The settings are saved automatically.
          </Text>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <TextInput
            label="Database name"
            required
            description={test?.databaseExists ? 'This database already exists. Existing data is kept.' : undefined}
            value={database}
            onChange={(e) => setDatabase(e.currentTarget.value)}
            maxLength={100}
          />
          <Checkbox
            checked={loadSample}
            onChange={(e) => setLoadSample(e.currentTarget.checked)}
            label="Add sample employees and products (for trying out the app, not for real use)"
          />
          <DoneList items={log} />
          <Group justify="flex-end" gap="xs">
            <Button className="wd-soft" onClick={() => setStepIndex(0)} disabled={!!busy}>
              Back
            </Button>
            <Button type="submit" className="wd-ink" loading={busy === 'install'} disabled={(!!busy && busy !== 'install') || !database.trim()}>
              Create database
            </Button>
          </Group>
        </Stack>
      </form>
    );
  }

  return (
    <Stack gap="md">
      <H2>Connect to SQL Server</H2>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {actionMsg && <InfoAlert>{actionMsg}</InfoAlert>}

      {instances.length > 0 ? (
        <Stack gap={8}>
          {instances.map((i) => (
            <div
              key={i.name}
              className="wd-pick"
              data-checked={selected?.name === i.name}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: 12, boxShadow: 'inset 0 0 0 1px var(--wd-line)' }}
              onClick={() => {
                setServer(i.server);
                setPort('');
                setTest(null);
              }}
            >
              <Group gap={12} wrap="nowrap">
                <Radio readOnly checked={selected?.name === i.name} aria-label={i.server} />
                <div>
                  <Text fw={600} className="wd-mono">
                    {i.server}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {i.version}
                  </Text>
                </div>
              </Group>
              <Group gap={14} wrap="wrap">
                <Check ok={i.running} label={i.running ? 'Running' : 'Stopped'} />
                <Check ok={i.tcpEnabled} label={i.tcpEnabled ? 'TCP/IP on' : 'TCP/IP off'} />
                <Check ok={i.mixedMode} warn label={i.mixedMode ? 'SQL logins on' : 'Windows logins only'} />
              </Group>
              {(!i.running || !i.tcpEnabled || !i.mixedMode) && (
                <Group gap={6} onClick={(e) => e.stopPropagation()}>
                  {!i.running && (
                    <Button size="xs" className="wd-soft" disabled={!!busy && busy !== 'start-service'} loading={busy === 'start-service'} onClick={() => runAction('start-service', i.name)}>
                      Start service
                    </Button>
                  )}
                  {!i.tcpEnabled && (
                    <Button size="xs" className="wd-soft" disabled={!!busy && busy !== 'enable-tcp'} loading={busy === 'enable-tcp'} onClick={() => runAction('enable-tcp', i.name)}>
                      Enable TCP/IP
                    </Button>
                  )}
                  {!i.mixedMode && (
                    <Button
                      size="xs"
                      className="wd-soft"
                      disabled={!!busy && busy !== 'enable-mixed-mode'}
                      loading={busy === 'enable-mixed-mode'}
                      onClick={() => runAction('enable-mixed-mode', i.name)}
                    >
                      Enable SQL logins
                    </Button>
                  )}
                </Group>
              )}
            </div>
          ))}
          <Text size="xs" c="dimmed">
            Buttons that change SQL Server show a Windows administrator prompt and restart that SQL Server instance.
          </Text>
        </Stack>
      ) : (
        <InfoAlert>No SQL Server was found on this computer. Install SQL Server (Express is fine), or enter the name of another server below.</InfoAlert>
      )}

      <TextInput
        label="Server"
        required
        description="e.g. localhost, localhost\SQL2022 or 192.168.1.10"
        classNames={{ input: 'wd-mono' }}
        value={server}
        onChange={(e) => {
          setServer(e.currentTarget.value);
          setTest(null);
        }}
      />

      <Radio.Group label="Sign in to SQL Server as an administrator (used only for setup)" value={authType} onChange={(v) => setAuthType(v as 'windows' | 'sql')}>
        <Stack gap={8} mt={8}>
          <Radio value="windows" disabled={!env?.sqlcmdAvailable} label={`My Windows account${env?.sqlcmdAvailable ? '' : ' (needs sqlcmd, not found)'}`} />
          <Radio value="sql" label="SQL Server login (e.g. sa)" />
        </Stack>
      </Radio.Group>
      {authType === 'sql' && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput label="Login" value={user} onChange={(e) => setUser(e.currentTarget.value)} autoComplete="off" />
          <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="off" />
        </SimpleGrid>
      )}

      <UnstyledButton onClick={() => setShowAdvanced((s) => !s)} c="dimmed" fz="sm">
        <Group gap={4}>
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced connection options
        </Group>
      </UnstyledButton>
      <Collapse in={showAdvanced}>
        <Stack gap="sm" p="md" style={{ background: 'var(--wd-surface)', borderRadius: 14 }}>
          <TextInput
            label="TCP port (optional)"
            description="Only if SQL Server uses a fixed port instead of the SQL Server Browser"
            value={port}
            onChange={(e) => setPort(e.currentTarget.value.replace(/\D/g, ''))}
            maxLength={5}
          />
          <Checkbox checked={encrypt} onChange={(e) => setEncrypt(e.currentTarget.checked)} label="Encrypt connection" />
          <Checkbox
            checked={trustCert}
            onChange={(e) => setTrustCert(e.currentTarget.checked)}
            label="Trust server certificate (needed for SQL Server's default self-signed certificate)"
          />
        </Stack>
      </Collapse>

      {test && !test.ok && <ErrorAlert>{test.error}</ErrorAlert>}
      {test?.ok && (
        <Alert color={canContinue ? 'teal' : 'red'} variant="light" radius="lg">
          Connected: SQL Server {test.version}
          {!test.isSysadmin && <div>Warning: this login is not a sysadmin; creating the database or login may fail.</div>}
          {!test.mixedMode && (
            <div>
              This SQL Server allows only Windows logins. Q-WorkDone needs SQL logins enabled. Use the <strong>Enable SQL logins</strong> button above.
            </div>
          )}
        </Alert>
      )}

      <Group justify="flex-end" gap="xs">
        <Button className="wd-soft" onClick={testConnection} loading={busy === 'test'} disabled={(!!busy && busy !== 'test') || !server.trim()}>
          Test connection
        </Button>
        <Button className="wd-ink" onClick={() => setStepIndex(1)} disabled={!canContinue || !!busy}>
          Next
        </Button>
      </Group>
    </Stack>
  );
}

// ---------------------------------------------------------------- Step 3
function AdminStep({ status, intro, onDone }: { status: SetupStatus; intro: string[]; onDone: () => void }) {
  const isWindows = status.environment?.platform === 'win32';
  const [company, setCompany] = useState({ companyName: '', clientId: '' });
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [firewall, setFirewall] = useState(isWindows);
  const [autostart, setAutostart] = useState(isWindows);
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
        [firewall, 'firewall'],
        [autostart, 'autostart'],
      ] as const) {
        if (!enabled) continue;
        try {
          const r = await api.post<{ message: string }>('/setup/system-action', { action });
          done.push(r.message);
        } catch (err) {
          done.push(`Skipped ${action}: ${errorMessage(err)}`);
        }
      }
      await api.post('/setup/admin', { ...company, username: username.trim(), password });
      setNotes(done);
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
        <CompanyFields value={company} onChange={setCompany} errors={errors} />
        <H2>Administrator account</H2>
        <Text c="dimmed" mt={-8}>
          This account manages users, employees and products. Keep the password safe.
        </Text>
        <TextInput label="Username" required error={errors.username} value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoComplete="off" />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <PasswordInput label="Password" required error={errors.password} value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="new-password" />
          <PasswordInput label="Confirm password" required error={errors.confirm} value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} autoComplete="new-password" />
        </SimpleGrid>
        {isWindows && (
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

// ---------------------------------------------------------------- Step 4
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
      {env && env.lanAddresses.length > 0 && (
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
        To host more companies on this server, open <code>http://localhost:{env?.port ?? 3000}/clients</code> on this computer. Each company gets its own Client
        ID and database.
      </Text>
      <Group justify="flex-end">
        <Button className="wd-ink" onClick={() => window.location.replace('/')}>
          Go to sign in
        </Button>
      </Group>
    </Stack>
  );
}

// ---------------------------------------------------------------- Company (Client ID)
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

function CompanyFields({ value, onChange, errors }: { value: CompanyValue; onChange: (v: CompanyValue) => void; errors: Record<string, string> }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      <TextInput
        label="Company name"
        required
        error={errors.companyName}
        value={value.companyName}
        onChange={(e) => onChange({ ...value, companyName: e.currentTarget.value })}
        maxLength={150}
      />
      <TextInput
        label="Client ID"
        required
        error={errors.clientId}
        description={errors.clientId ? undefined : 'Short code everyone types at sign-in, e.g. ACME'}
        classNames={{ input: 'wd-mono' }}
        value={value.clientId}
        onChange={(e) => onChange({ ...value, clientId: e.currentTarget.value.toUpperCase().trim() })}
        maxLength={30}
        autoComplete="off"
        spellCheck={false}
      />
    </SimpleGrid>
  );
}

/** For a database set up before Client IDs existed: name the company that owns it. */
function CompanyStep() {
  const [company, setCompany] = useState({ companyName: '', clientId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateCompany(company);
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/setup/company', company);
      window.location.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        <H2>Set your Client ID</H2>
        <Text c="dimmed">
          Q-WorkDone now signs users in with a <strong>Client ID</strong> as well as their user ID, so one server can host several companies. Choose the Client
          ID for the company whose data is already in this database.
        </Text>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <CompanyFields value={company} onChange={setCompany} errors={errors} />
        <Group justify="flex-end">
          <Button type="submit" className="wd-ink" loading={busy}>
            Save and continue
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Applies the latest table changes to a database created by an older version. */
function UpgradeStep({ sqlcmdAvailable, onDone }: { sqlcmdAvailable: boolean; onDone: () => Promise<void> }) {
  const [useSqlLogin, setUseSqlLogin] = useState(!sqlcmdAvailable);
  const [user, setUser] = useState('sa');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/setup/upgrade', useSqlLogin ? { user, password } : {});
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <H2>Update the database</H2>
        <Text c="dimmed">This version of Q-WorkDone needs a few new tables. Your existing data is kept. Updating needs SQL Server administrator rights once.</Text>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Radio.Group value={useSqlLogin ? 'sql' : 'windows'} onChange={(v) => setUseSqlLogin(v === 'sql')}>
          <Stack gap={8}>
            <Radio value="windows" disabled={!sqlcmdAvailable} label={`My Windows account${sqlcmdAvailable ? '' : ' (needs sqlcmd, not found)'}`} />
            <Radio value="sql" label="SQL Server login (e.g. sa)" />
          </Stack>
        </Radio.Group>
        {useSqlLogin && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput label="Login" value={user} onChange={(e) => setUser(e.currentTarget.value)} autoComplete="off" />
            <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="off" />
          </SimpleGrid>
        )}
        <Group justify="flex-end">
          <Button type="submit" className="wd-ink" loading={busy}>
            Update database
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
