import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardList,
  Droplets,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Radio,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, formatRelative, initials } from '../lib/format';
import { useRealtime, type RealtimeStatus } from '../lib/realtime';
import type { NotificationItem, Paginated } from '../lib/types';
import {
  Button,
  Field,
  FormError,
  Modal,
  PasswordInput,
  RoleBadge,
  useToast,
} from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
  end?: boolean;
}

const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/drains', label: 'Drains & map', icon: Map },
      {
        to: '/alerts',
        label: 'Alerts',
        icon: Bell,
        roles: ['ADMIN', 'SUPERVISOR', 'TECHNICIAN'],
      },
      { to: '/tasks', label: 'Maintenance', icon: ClipboardList },
      { to: '/engineering', label: 'Engineering', icon: FlaskConical },
    ],
  },
  {
    label: 'Insight',
    items: [{ to: '/reports', label: 'Reports', icon: BarChart3 }],
  },
  {
    label: 'Administration',
    items: [
      { to: '/system', label: 'System health', icon: Activity },
      { to: '/admin', label: 'Administration', icon: Users, roles: ['ADMIN'] },
    ],
  },
];

const routeTitles: Record<string, string> = {
  '/': 'Operations dashboard',
  '/drains': 'Drains & map',
  '/alerts': 'Alerts',
  '/tasks': 'Maintenance tasks',
  '/engineering': 'Engineering review',
  '/reports': 'Reports',
  '/system': 'System health',
  '/admin': 'Administration',
};

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/drains/')) return 'Drain detail';
  return routeTitles[pathname] ?? 'DrainGuard';
}

function RealtimeIndicator({ status }: { status: RealtimeStatus }) {
  const config = {
    connected: { label: 'Live', dot: 'bg-emerald-400', text: 'text-emerald-100' },
    connecting: { label: 'Connecting', dot: 'bg-amber-400', text: 'text-amber-100' },
    polling: { label: '10s polling', dot: 'bg-slate-400', text: 'text-slate-300' },
  }[status];

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', config.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { session } = useAuth();
  const role = session?.user.role;

  const query = useQuery({
    queryKey: ['notifications', 'header'],
    queryFn: () => api.get<Paginated<NotificationItem> & { recent: number }>('/api/notifications', { pageSize: 8 }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [open]);

  const openNotification = (item: NotificationItem) => {
    setOpen(false);
    if (role === 'ENGINEER' && item.alert?.drain?.id) {
      navigate(`/drains/${item.alert.drain.id}`);
    } else {
      navigate(`/alerts?alertId=${encodeURIComponent(item.alertId)}`);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {query.data && query.data.recent > 0 ? (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {query.data.recent > 99 ? '99+' : query.data.recent}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="animate-fade-up absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
              <p className="text-[11px] text-slate-500">In-app messages from the last 7 days</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
              {query.data?.recent ?? 0}
            </span>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {query.isLoading ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-14 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : query.isError ? (
              <p className="p-5 text-sm text-red-700">{errorMessage(query.error)}</p>
            ) : query.data?.data.length ? (
              query.data.data.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openNotification(item)}
                  className="block w-full border-b border-slate-100 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        item.status === 'FAILED' ? 'bg-red-500' : 'bg-brand-500',
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {item.alert?.message ?? 'Drain monitoring alert'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {item.alert?.drain?.name ?? item.recipient}
                        {item.kind === 'ESCALATION' ? ' · escalation' : ''}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">{formatRelative(item.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <p className="px-5 py-10 text-center text-sm text-slate-500">No in-app notifications yet.</p>
            )}
          </div>
          <Link
            to="/alerts"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-4 py-3 text-center text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            View alert queue
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { session, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const realtime = useRealtime(Boolean(session));

  const user = session?.user;
  const role = user?.role ?? 'TECHNICIAN';

  const passwordMutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordOpen(false);
      toast('Password changed. Sign in again with your new password.', 'success');
      navigate('/login', { replace: true });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  useEffect(() => {
    setSidebarOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (newPassword.length < 8) {
      setFormError('The new password must be at least 8 characters.');
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setFormError('The new password must contain a letter and a number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('The new passwords do not match.');
      return;
    }
    passwordMutation.mutate();
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-slate-300">
      <div className="flex h-16 items-center gap-3 px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-900/40">
          <Droplets className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-white">DrainGuard</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Drainage operations</p>
        </div>
        <button
          type="button"
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {navSections.map((section) => {
          const items = section.items.filter((item) => !item.roles || item.roles.includes(role));
          if (items.length === 0) return null;
          return (
            <div key={section.label} className="mb-5">
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                        isActive
                          ? 'bg-white/10 text-white shadow-sm'
                          : 'text-slate-400 hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn('h-[18px] w-[18px]', isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300')} />
                        <span>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="rounded-xl bg-white/[0.04] p-3">
          <div className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-brand-300" />
            <span className="text-xs font-medium text-slate-200">Telemetry feed</span>
            <span className="ml-auto">
              <RealtimeIndicator status={realtime} />
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            Alerts and status updates refresh automatically. Polling covers interrupted streams.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-200">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-[11px] text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-mist">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] lg:block">{sidebar}</aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="animate-fade-up relative h-full w-[286px] max-w-[86vw]">{sidebar}</aside>
        </div>
      ) : null}

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            type="button"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{pageTitle(location.pathname)}</p>
            <p className="hidden text-[11px] text-slate-500 sm:block">
              {user.role === 'TECHNICIAN' ? 'Field maintenance view' : 'Earlier detection, targeted maintenance'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 sm:inline-flex">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  realtime === 'connected' ? 'bg-emerald-500' : realtime === 'connecting' ? 'bg-amber-500' : 'bg-slate-400',
                )}
              />
              {realtime === 'connected' ? 'Live updates' : realtime === 'connecting' ? 'Connecting' : 'Polling 10s'}
            </span>
            <NotificationsMenu />
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((current) => !current)}
                className="flex items-center gap-2 rounded-xl p-1.5 transition hover:bg-slate-100"
                aria-label="Account menu"
                aria-expanded={profileOpen}
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 text-xs font-bold text-white">
                  {initials(user.name)}
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
              </button>
              {profileOpen ? (
                <div className="animate-fade-up absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  <div className="border-b border-slate-100 p-4">
                    <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                    <div className="mt-2">
                      <RoleBadge role={user.role} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      setPasswordOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <ShieldCheck className="h-4 w-4 text-slate-400" />
                    Change password
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2.5 border-t border-slate-100 px-4 py-3 text-left text-sm text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>

      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Change password"
        description="Changing your password signs out all active sessions."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasswordOpen(false)} disabled={passwordMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="change-password-form" loading={passwordMutation.isPending}>
              Update password
            </Button>
          </>
        }
      >
        <form id="change-password-form" className="space-y-4" onSubmit={submitPassword}>
          {formError ? <FormError>{formError}</FormError> : null}
          <Field label="Current password" htmlFor="current-password">
            <PasswordInput
              id="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password" htmlFor="new-password" hint="At least 8 characters with a letter and number.">
            <PasswordInput
              id="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <PasswordInput
              id="confirm-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
