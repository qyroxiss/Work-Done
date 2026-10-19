import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Bezel, PageHeader, PersonAvatar } from '../components/common';
import { useAuth } from '../hooks/useAuth';
import { api, errorMessage } from '../services/api';
import { formatDateTime } from '../utils/format';

interface Health {
  status: string;
  database: string;
  time: string;
}

function Prop({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export function SettingsPage() {
  const { user, hasRole } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    if (!hasRole('Admin')) return;
    api
      .get<Health>('/health')
      .then(setHealth)
      .catch(() => setHealthError(true));
  }, [hasRole]);

  return (
    <Stack gap={24}>
      <PageHeader title="Settings" subtitle="Your account, your company and the server." />
      <div className="wd-settings">
        <Stack gap={20}>
          <Bezel title="My account" padding={18}>
            <Group gap={14} mb={16} wrap="nowrap">
              <PersonAvatar name={user?.employeeName ?? user?.username ?? '?'} size={44} />
              <div>
                <Text fw={600} fz={16}>
                  {user?.employeeName ?? user?.username}
                </Text>
                <Text c="dimmed" size="sm">
                  {user?.role}
                </Text>
              </div>
            </Group>
            <dl className="wd-props">
              <Prop k="Username" v={<span className="wd-mono">{user?.username}</span>} />
              <Prop k="Role" v={user?.role} />
            </dl>
          </Bezel>
          <CompanyCard />
          {hasRole('Admin') && (
            <Bezel title="System status" padding={18}>
              {healthError ? (
                <Alert color="red" variant="light" radius="lg">
                  Health check failed. The database may be unavailable.
                </Alert>
              ) : !health ? (
                <Text c="dimmed">Checking…</Text>
              ) : (
                <dl className="wd-props">
                  <Prop k="API" v={health.status === 'ok' ? 'Running' : health.status} />
                  <Prop k="Database" v={<Text span c={health.database === 'connected' ? undefined : 'red.7'} fw={500}>{health.database}</Text>} />
                  <Prop k="Server time" v={formatDateTime(health.time)} />
                  <Prop k="App version" v="1.0.0" />
                </dl>
              )}
              <Text size="xs" c="dimmed" mt={12}>
                Session timeout, database connection and HTTPS are set in the backend <code>.env</code> file. See docs/DEPLOYMENT.md.
              </Text>
            </Bezel>
          )}
        </Stack>
        <Bezel title="Change password" padding={18}>
          <ChangePasswordForm />
        </Bezel>
      </div>
    </Stack>
  );
}

/** Company of the signed-in user. Admins may rename it; the Client ID is fixed. */
function CompanyCard() {
  const { company, setCompany, hasRole } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!company) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await api.put<{ companyName: string; clientId: string }>('/settings/company', { companyName: name });
      setCompany({ name: r.companyName, clientId: r.clientId });
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Bezel
      title="Company"
      padding={18}
      extra={
        hasRole('Admin') &&
        !editing && (
          <Button
            size="xs"
            className="wd-soft"
            onClick={() => {
              setName(company.name);
              setEditing(true);
            }}
          >
            Rename
          </Button>
        )
      }
    >
      {editing ? (
        <form onSubmit={save}>
          <Stack gap="md">
            {error && (
              <Alert color="red" variant="light" radius="lg">
                {error}
              </Alert>
            )}
            <TextInput label="Company name" required value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={150} data-autofocus autoFocus />
            <Group justify="flex-end" gap="xs">
              <Button className="wd-soft" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" className="wd-ink" loading={saving} disabled={!name.trim()}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <>
          <dl className="wd-props">
            <Prop k="Company" v={company.name} />
            <Prop k="Client ID" v={<span className="wd-mono">{company.clientId}</span>} />
          </dl>
          <Text size="xs" c="dimmed" mt={12}>
            Everyone in your company signs in with this Client ID.
          </Text>
        </>
      )}
    </Bezel>
  );
}
