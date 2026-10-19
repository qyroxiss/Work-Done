import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Burger, Button, Drawer, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  BarChart3,
  ChevronDown,
  FolderTree,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  Package,
  Plus,
  Repeat,
  Settings,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useChat } from '../hooks/useChat';
import { useConfirm } from '../hooks/useConfirm';
import type { Role } from '../types';
import { APP_NAME, BrandMark } from './Brand';
import { PersonAvatar, Spinner } from './common';
import { NotificationBell } from './NotificationBell';
import { Shortcuts } from './Shortcuts';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** One line under the label in the Manage menu */
  hint?: string;
  roles?: Role[];
  end?: boolean;
}

const MAIN: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/work', label: 'Work', icon: ListChecks, end: true },
  { to: '/chat', label: 'Chat', icon: MessagesSquare },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['Admin', 'Manager'] },
];

const MANAGE: NavItem[] = [
  { to: '/recurring', label: 'Repeating work', icon: Repeat, hint: 'Monthly returns and regular tasks', roles: ['Admin', 'Manager'] },
  { to: '/employees', label: 'Employees', icon: Users, hint: 'People who can be assigned work', roles: ['Admin', 'Manager'] },
  { to: '/product-groups', label: 'Product groups', icon: FolderTree, hint: 'Categories of products', roles: ['Admin'] },
  { to: '/products', label: 'Products', icon: Package, hint: 'What your office works on', roles: ['Admin'] },
  { to: '/users', label: 'Users', icon: UserCog, hint: 'Sign-ins and roles', roles: ['Admin'] },
];

const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings };

export function Layout() {
  const { user, company, logout, hasRole } = useAuth();
  const { unread } = useChat();
  const confirm = useConfirm();
  const [drawerOpen, drawer] = useDisclosure(false);
  const location = useLocation();

  useEffect(drawer.close, [location.pathname, drawer.close]);

  if (!user) return null;
  const allowed = (n: NavItem) => !n.roles || n.roles.includes(user.role);
  const main = MAIN.filter(allowed);
  const manage = MANAGE.filter(allowed);
  const isActive = (to: string) => location.pathname.startsWith(to);
  const manageActive = manage.some((m) => isActive(m.to));
  const displayName = user.employeeName ?? user.username;
  const canCreate = hasRole('Admin', 'Manager');

  const onLogout = async () => {
    if (await confirm({ title: 'Log out', message: `Do you want to log out of ${APP_NAME}?`, confirmLabel: 'Log out' })) {
      await logout();
    }
  };

  const chatDot = (item: NavItem) => item.to === '/chat' && unread > 0 && <span className="wd-unread" aria-label={`${unread} unread`} />;

  const topLink = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.end} className="wd-nav-link">
      {item.label}
      {chatDot(item)}
    </NavLink>
  );

  const drawerLink = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <NavLink key={item.to} to={item.to} end={item.end} className="wd-side-link">
        <span className="wd-side-icon">
          <Icon size={16} />
        </span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.to === '/chat' && unread > 0 && <span className="wd-side-count">{unread > 99 ? '99+' : unread}</span>}
      </NavLink>
    );
  };

  return (
    <>
      <nav className="wd-nav" aria-label="Main">
        <Burger opened={drawerOpen} onClick={drawer.toggle} hiddenFrom="md" size="sm" aria-label="Open menu" mx={6} />
        <NavLink to="/" className="wd-brand">
          <BrandMark size={26} />
          {APP_NAME}
        </NavLink>

        <Group gap={2} visibleFrom="md" wrap="nowrap">
          <span className="wd-nav-sep" />
          {main.map(topLink)}
          {manage.length > 0 && (
            <Menu position="bottom-start" width={300} offset={12} classNames={{ dropdown: 'wd-menu' }} transitionProps={{ transition: 'pop-top-left', duration: 140 }}>
              <Menu.Target>
                <button type="button" className="wd-nav-link" data-active={manageActive}>
                  Manage <ChevronDown size={14} className="wd-chevron" />
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                <div className="wd-menu-card">
                  {manage.map((m) => {
                    const Icon = m.icon;
                    return (
                      <Menu.Item key={m.to} component={NavLink} to={m.to} className="wd-menu-item" data-current={isActive(m.to)}>
                        <span className="wd-menu-icon">
                          <Icon size={16} />
                        </span>
                        <span>
                          <span className="wd-menu-title">{m.label}</span>
                          <span className="wd-menu-hint">{m.hint}</span>
                        </span>
                      </Menu.Item>
                    );
                  })}
                </div>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>

        <Group gap={6} ml="auto" wrap="nowrap">
          {company && (
            <Text className="wd-mono" c="dimmed" px={8} visibleFrom="sm" title={company.name}>
              {company.clientId}
            </Text>
          )}
          <NotificationBell />
          <ThemeToggle onCard />
          {canCreate && (
            <Button component={NavLink} to="/work/new" className="wd-ink" h={34} radius={10} px={14} leftSection={<Plus size={14} />} visibleFrom="xs">
              New work
            </Button>
          )}
          <Menu position="bottom-end" width={240} offset={12} classNames={{ dropdown: 'wd-menu' }}>
            <Menu.Target>
              <UnstyledButton aria-label={`Account: ${displayName}`} style={{ borderRadius: '50%', display: 'flex' }}>
                <PersonAvatar name={displayName} size={34} />
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Group gap={10} px={10} pt={6} pb={10} wrap="nowrap">
                <PersonAvatar name={displayName} size={34} />
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>
                    {displayName}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {user.role}
                    {company ? ` · ${company.name}` : ''}
                  </Text>
                </div>
              </Group>
              <div className="wd-menu-card">
                <Menu.Item component={NavLink} to="/settings" leftSection={<Settings size={15} />}>
                  Settings
                </Menu.Item>
                <Menu.Item
                  leftSection={<Keyboard size={15} />}
                  rightSection={<kbd className="wd-kbd">?</kbd>}
                  onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
                  visibleFrom="sm"
                >
                  Keyboard shortcuts
                </Menu.Item>
                <Menu.Item color="red" leftSection={<LogOut size={15} />} onClick={onLogout}>
                  Log out
                </Menu.Item>
              </div>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </nav>

      <Drawer
        opened={drawerOpen}
        onClose={drawer.close}
        position="left"
        size={300}
        offset={10}
        radius={24}
        withCloseButton={false}
        hiddenFrom="md"
        aria-label="Menu"
        styles={{
          content: { background: 'var(--wd-surface)', display: 'flex', flexDirection: 'column' },
          body: { padding: 6, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
        }}
      >
        <Group justify="space-between" px={10} pt={6} pb={12} wrap="nowrap">
          <span className="wd-brand" style={{ padding: 0 }}>
            <BrandMark size={26} />
            {APP_NAME}
          </span>
          <UnstyledButton onClick={drawer.close} aria-label="Close menu" className="wd-side-close">
            <X size={16} />
          </UnstyledButton>
        </Group>

        <div className="wd-card" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, borderRadius: 18 }}>
          <Stack gap={2}>
            {canCreate && (
              <Button component={NavLink} to="/work/new" className="wd-ink" leftSection={<Plus size={15} />} mb={8} h={40}>
                New work
              </Button>
            )}
            {main.map(drawerLink)}
            {manage.length > 0 && (
              <Text className="wd-eyebrow" fz={12} mt={14} mb={4} px={10}>
                Manage
              </Text>
            )}
            {manage.map(drawerLink)}
            <div style={{ height: 1, background: 'var(--wd-line)', margin: '10px 6px' }} />
            {drawerLink(SETTINGS)}
          </Stack>
        </div>

        <Group gap={10} px={10} pt={12} pb={6} wrap="nowrap">
          <PersonAvatar name={displayName} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} truncate>
              {displayName}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {user.role}
              {company ? ` · ${company.clientId}` : ''}
            </Text>
          </div>
          <Button variant="subtle" color="red" size="compact-sm" leftSection={<LogOut size={14} />} onClick={onLogout}>
            Log out
          </Button>
        </Group>
      </Drawer>

      <main className="wd-main">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
      <Shortcuts />
    </>
  );
}
