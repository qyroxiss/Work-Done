import { useState, type FormEvent } from 'react';
import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core';
import { AlertCircle, ArrowRight, Info } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../hooks/useAuth';
import { errorMessage } from '../services/api';

/** The last Client ID used on this computer, so users only type it once. */
const CLIENT_ID_KEY = 'wd_client_id';

function readSavedClientId(): string {
  try {
    return localStorage.getItem(CLIENT_ID_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveClientId(value: string) {
  try {
    localStorage.setItem(CLIENT_ID_KEY, value);
  } catch {
    /* storage blocked: the user simply types it again next time */
  }
}

export function LoginPage() {
  const { login, notice } = useAuth();
  const [clientId, setClientId] = useState(readSavedClientId);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientId.trim() || !username.trim() || !password) {
      setError('Enter your Client ID, User ID and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(clientId.trim(), username.trim(), password);
      saveClientId(clientId.trim().toUpperCase());
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Work management for your office"
      title="Welcome back"
      subtitle="Sign in to see the work assigned to you and your team."
      note="Forgot your password? Ask your administrator to reset it."
    >
      <form onSubmit={submit} noValidate>
        <Stack gap="md">
          {notice && !error && (
            <Alert color="blue" variant="light" radius="md" icon={<Info size={18} />}>
              {notice}
            </Alert>
          )}
          {error && (
            <Alert color="red" variant="light" radius="md" icon={<AlertCircle size={18} />}>
              {error}
            </Alert>
          )}
          <TextInput
            size="md"
            label="Client ID"
            placeholder="e.g. ACME"
            autoComplete="organization"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={30}
            autoFocus={!clientId}
            value={clientId}
            onChange={(e) => setClientId(e.currentTarget.value.toUpperCase())}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', letterSpacing: '0.06em' } }}
          />
          <TextInput
            size="md"
            label="User ID or email"
            placeholder="Your user ID"
            autoComplete="username"
            spellCheck={false}
            maxLength={150}
            autoFocus={!!clientId}
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
          />
          <PasswordInput
            size="md"
            label="Password"
            placeholder="••••••••"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Button type="submit" size="md" fullWidth mt={6} className="wd-ink" loading={busy} rightSection={<ArrowRight size={16} />}>
            Sign in
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
