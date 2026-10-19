import { useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Group, Menu, PasswordInput, Select, Text } from '@mantine/core';
import { KeyRound } from 'lucide-react';
import { PersonAvatar } from '../components/common';
import { MasterPage } from '../components/MasterPage';
import { Modal } from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import { useLookups } from '../hooks/useLookups';
import { useToast } from '../hooks/useToast';
import { api, ApiError, errorMessage } from '../services/api';
import { ROLES, type Role, type UserAccount } from '../types';
import { relativeTime } from '../utils/format';

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v.trim() : '');

const ROLE_COLOR: Record<Role, string> = { Admin: 'dark', Manager: 'blue', Employee: 'gray' };

export function UsersPage() {
  const { user: me } = useAuth();
  const { employees } = useLookups({ employees: true, includeInactive: true });
  const [resetFor, setResetFor] = useState<UserAccount | null>(null);
  const [roleFilter, setRoleFilter] = useState('');

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: String(e.employeeId),
        label: `${e.employeeName} (${e.employeeCode})${e.isActive ? '' : ' – inactive'}`,
      })),
    [employees],
  );

  return (
    <>
      <MasterPage<UserAccount>
        title="Users"
        subtitle="Sign-in accounts and roles. Employee accounts must be linked to an employee."
        entityName="user"
        endpoint="/users"
        getId={(u) => u.userId}
        getLabel={(u) => u.username}
        canEdit
        extraQuery={{ role: roleFilter || undefined }}
        extraFilters={
          <Select
            className="wd-chip"
            data-active={roleFilter !== ''}
            radius="xl"
            w={140}
            aria-label="Role"
            placeholder="Role"
            clearable
            data={ROLES}
            value={roleFilter || null}
            onChange={(v) => setRoleFilter(v ?? '')}
          />
        }
        columns={[
          {
            header: 'User',
            render: (u) => (
              <Group gap={10} wrap="nowrap">
                <PersonAvatar name={u.employeeName ?? u.username} size={30} />
                <div>
                  <Text fw={500}>
                    {u.username}
                    {u.userId === me?.userId && (
                      <Text span c="dimmed" size="sm">
                        {' '}
                        (you)
                      </Text>
                    )}
                  </Text>
                  {u.employeeName && (
                    <Text size="xs" c="dimmed">
                      {u.employeeName} · <span className="wd-mono">{u.employeeCode}</span>
                    </Text>
                  )}
                </div>
              </Group>
            ),
          },
          {
            header: 'Role',
            render: (u) => (
              <Badge variant={u.role === 'Admin' ? 'filled' : 'light'} color={ROLE_COLOR[u.role]} radius="xl" tt="none" fw={500}>
                {u.role}
              </Badge>
            ),
          },
          { header: 'Client ID', render: (u) => <span className="wd-mono">{u.clientId ?? '—'}</span>, className: 'hide-sm' },
          {
            header: 'Last sign-in',
            render: (u) => <Text c="dimmed">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</Text>,
            className: 'hide-sm',
          },
          {
            header: 'Password',
            render: (u) =>
              u.mustChangePassword ? (
                <Text size="sm" c="orange.7">
                  Must change
                </Text>
              ) : (
                <Text c="dimmed">Set</Text>
              ),
            className: 'hide-md',
          },
        ]}
        fields={[
          {
            name: 'username',
            label: 'Username',
            required: true,
            maxLength: 50,
            createOnly: true,
            hint: 'Letters, numbers, dot, dash or underscore',
          },
          {
            name: 'password',
            label: 'Initial password',
            type: 'password',
            required: true,
            maxLength: 128,
            createOnly: true,
            hint: 'At least 8 characters with letters and numbers. They change it at first sign-in.',
          },
          {
            name: 'role',
            label: 'Role',
            type: 'select',
            required: true,
            options: ROLES.map((r) => ({ value: r, label: r })),
          },
          {
            name: 'employeeId',
            label: 'Linked employee',
            type: 'select',
            options: employeeOptions,
            placeholder: 'None',
            hint: 'Required for the Employee role',
          },
          { name: 'isActive', label: 'Active (can sign in)', type: 'checkbox' },
        ]}
        emptyForm={{ username: '', password: '', role: 'Employee', employeeId: '', isActive: true }}
        toForm={(u) => ({
          username: u.username,
          password: '',
          role: u.role,
          employeeId: u.employeeId ? String(u.employeeId) : '',
          isActive: u.isActive,
        })}
        toPayload={(f, editing) => {
          const common = {
            role: str(f.role),
            employeeId: str(f.employeeId) ? Number(f.employeeId) : null,
            isActive: Boolean(f.isActive),
          };
          return editing
            ? common
            : { ...common, username: str(f.username), password: String(f.password ?? ''), mustChangePassword: true };
        }}
        rowActions={(u) => (
          <Menu.Item leftSection={<KeyRound size={15} />} onClick={() => setResetFor(u)}>
            Reset password
          </Menu.Item>
        )}
      />
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
    </>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserAccount; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Password must be at least 8 characters and contain letters and numbers.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/users/${user.userId}/reset-password`, { password });
      toast.success(`Password reset for ${user.username}. They must change it at next sign-in.`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.password ? err.fields.password : errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Reset password for ${user.username}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button className="wd-soft" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button color="red" type="submit" form="reset-form" loading={saving}>
            Reset password
          </Button>
        </>
      }
    >
      <form id="reset-form" onSubmit={submit} noValidate>
        <Text c="dimmed" mb="md">
          They will be signed out everywhere and must choose a new password at next sign-in.
        </Text>
        <PasswordInput
          label="New temporary password"
          required
          error={error ?? undefined}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          data-autofocus
        />
      </form>
    </Modal>
  );
}
