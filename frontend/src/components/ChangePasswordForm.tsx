import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Alert, Button, Group, PasswordInput, Stack } from '@mantine/core';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError, errorMessage } from '../services/api';
import type { AuthUser } from '../types';

export function ChangePasswordForm({ onDone, fullWidth }: { onDone?: () => void; fullWidth?: boolean }) {
  const { setUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.currentPassword) errs.currentPassword = 'Current password is required';
    if (form.newPassword.length < 8) errs.newPassword = 'Password must be at least 8 characters';
    else if (!/[A-Za-z]/.test(form.newPassword) || !/\d/.test(form.newPassword))
      errs.newPassword = 'Password must contain letters and numbers';
    if (form.confirm !== form.newPassword) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const r = await api.post<{ user: AuthUser }>('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setDone(true);
      setUser(r.user);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        {error && (
          <Alert color="red" variant="light" icon={<AlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        {done && (
          <Alert color="teal" variant="light" icon={<CheckCircle2 size={18} />}>
            Password changed successfully. Other devices have been signed out.
          </Alert>
        )}
        <PasswordInput
          label="Current password"
          required
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={set('currentPassword')}
          error={errors.currentPassword}
        />
        <PasswordInput
          label="New password"
          required
          description="At least 8 characters with letters and numbers"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={set('newPassword')}
          error={errors.newPassword}
        />
        <PasswordInput
          label="Confirm new password"
          required
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        <Group>
          <Button type="submit" loading={saving} fullWidth={fullWidth}>
            Change password
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
