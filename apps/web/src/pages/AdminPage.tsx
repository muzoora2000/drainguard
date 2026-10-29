import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CloudRain,
  Copy,
  Droplets,
  KeyRound,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
  UserCheck,
  UserX,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce } from '../hooks/useDebounce';
import {
  cn,
  copyText,
  enumLabel,
  formatDateTime,
  formatNumber,
  formatRelative,
  toDateTimeLocal,
} from '../lib/format';
import type {
  DeviceHealth,
  DeviceSummary,
  DeviceType,
  DrainListItem,
  DrainStatus,
  Paginated,
  RainfallReading,
  RainfallSource,
  Role,
  UserWithAssignments,
} from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DeviceHealthBadge,
  DrainStatusBadge,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  RoleBadge,
  SidePanel,
  Tabs,
  useToast,
} from '../components/ui';

type AdminTab = 'users' | 'drains' | 'devices' | 'rainfall';

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        description="Manage people, the drainage register, monitoring devices and manual rainfall observations."
        eyebrow="Admin workspace"
        actions={<Badge tone="violet">Administrator access</Badge>}
      />
      <Tabs
        value={tab}
        onChange={(value) => setTab(value as AdminTab)}
        tabs={[
          { value: 'users', label: 'Users' },
          { value: 'drains', label: 'Drains' },
          { value: 'devices', label: 'Devices' },
          { value: 'rainfall', label: 'Rainfall' },
        ]}
      />
      {tab === 'users' ? <UsersAdmin /> : null}
      {tab === 'drains' ? <DrainsAdmin /> : null}
      {tab === 'devices' ? <DevicesAdmin /> : null}
      {tab === 'rainfall' ? <RainfallAdmin /> : null}
    </div>
  );
}

interface UserFormState {
  name: string;
  email: string;
  role: Role;
  phone: string;
  password: string;
  smsOptIn: boolean;
  inAppOptIn: boolean;
  isFallbackContact: boolean;
  active: boolean;
}

const emptyUserForm: UserFormState = {
  name: '',
  email: '',
  role: 'TECHNICIAN',
  phone: '',
  password: '',
  smsOptIn: true,
  inAppOptIn: true,
  isFallbackContact: false,
  active: true,
};

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

function UsersAdmin() {
  const { session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserWithAssignments | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyUserForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [assignmentUser, setAssignmentUser] = useState<UserWithAssignments | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    label: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', page, debouncedSearch, role, active],
    queryFn: () =>
      api.get<Paginated<UserWithAssignments>>('/api/users', {
        page,
        pageSize: 12,
        q: debouncedSearch || undefined,
        role: role || undefined,
        active: active || undefined,
      }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyUserForm);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (user: UserWithAssignments) => {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone ?? '',
      password: '',
      smsOptIn: user.smsOptIn,
      inAppOptIn: user.inAppOptIn,
      isFallbackContact: user.isFallbackContact,
      active: user.active,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setFormError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setFormError('Name and email are required.');
      return;
    }
    if (!editing && form.password.length < 8) {
      setFormError('A password of at least 8 characters is required.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        phone: form.phone.trim() || null,
        smsOptIn: form.smsOptIn,
        inAppOptIn: form.inAppOptIn,
        isFallbackContact: form.isFallbackContact,
        active: form.active,
        ...(form.password ? { password: form.password } : {}),
      };
      if (editing) {
        await api.patch(`/api/users/${editing.id}`, body);
        toast('User updated.', 'success');
      } else {
        await api.post('/api/users', body);
        toast('User created.', 'success');
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setFormOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirming(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setConfirming(false);
    }
  };

  const toggleActive = (user: UserWithAssignments) => {
    if (user.id === session?.user.id) {
      toast('You cannot deactivate your own account.', 'error');
      return;
    }
    setConfirm({
      title: user.active ? 'Deactivate account?' : 'Reactivate account?',
      description: user.active
        ? `${user.name} will be signed out and will no longer be able to access DrainGuard. Their records remain available.`
        : `${user.name} will be able to sign in again with their existing credentials.`,
      label: user.active ? 'Deactivate' : 'Reactivate',
      action: async () => {
        await api.patch(`/api/users/${user.id}`, { active: !user.active });
        await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
        toast(user.active ? 'User deactivated.' : 'User reactivated.', 'success');
      },
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="field-label" htmlFor="user-search">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="user-search"
                className="field-input pl-9"
                placeholder="Name, email or phone"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <div className="w-40">
            <label className="field-label" htmlFor="user-role">
              Role
            </label>
            <select
              id="user-role"
              className="field-select"
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All roles</option>
              {(['ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'ENGINEER'] as Role[]).map((item) => (
                <option key={item} value={item}>
                  {enumLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="field-label" htmlFor="user-active">
              Status
            </label>
            <select
              id="user-active"
              className="field-select"
              value={active}
              onChange={(event) => {
                setActive(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          <Button icon={Plus} onClick={openCreate}>
            New user
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">User accounts</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {usersQuery.data ? `${formatNumber(usersQuery.data.meta.total)} accounts` : 'Loading accounts'}
            </p>
          </div>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void usersQuery.refetch()}>
            Refresh
          </Button>
        </div>
        {usersQuery.isLoading ? (
          <LoadingState rows={6} />
        ) : usersQuery.isError ? (
          <ErrorState message={errorMessage(usersQuery.error)} onRetry={() => void usersQuery.refetch()} />
        ) : usersQuery.data?.data.length ? (
          <>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Contact</th>
                    <th>Assignments</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersQuery.data.data.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <p className="font-medium text-slate-900">
                          {user.name}
                          {user.isFallbackContact ? (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-violet-600">Fallback</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-400">{user.email}</p>
                      </td>
                      <td>
                        <RoleBadge role={user.role} />
                      </td>
                      <td>
                        <p className="text-xs text-slate-600">{user.phone ?? 'No phone'}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {user.smsOptIn ? 'SMS' : 'No SMS'} · {user.inAppOptIn ? 'In-app' : 'No in-app'}
                        </p>
                      </td>
                      <td>
                        <span className="text-xs text-slate-600">
                          {user.assignments.length
                            ? `${user.assignments.filter((item) => item.drainId).length} drains · ${user.assignments.filter((item) => item.zone).length} zones`
                            : 'Unassigned'}
                        </span>
                      </td>
                      <td>
                        <Badge tone={user.active ? 'green' : 'slate'} dot>
                          {user.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>
                        <span className="text-xs text-slate-500">
                          {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="table-action"
                            onClick={() => openEdit(user)}
                            title="Edit user"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="table-action"
                            onClick={() => setAssignmentUser(user)}
                            title="Manage assignments"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={cn('table-action', user.active ? 'hover:text-red-600' : 'hover:text-emerald-600')}
                            onClick={() => toggleActive(user)}
                            title={user.active ? 'Deactivate' : 'Reactivate'}
                          >
                            {user.active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <Pagination
                page={usersQuery.data.meta.page}
                totalPages={usersQuery.data.meta.totalPages}
                total={usersQuery.data.meta.total}
                onPageChange={setPage}
              />
            </div>
          </>
        ) : (
          <EmptyState
            title="No users found"
            description="Adjust the filters or create a new account."
            icon={Users}
            action={<Button size="sm" icon={Plus} onClick={openCreate}>New user</Button>}
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit user' : 'Create user'}
        description={editing ? `Update the account for ${editing.name}.` : 'Create an operational or engineering account.'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} icon={editing ? Check : Plus} onClick={() => void save()}>
              {editing ? 'Save changes' : 'Create user'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <FormError>{formError}</FormError> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="user-name">
              <input
                id="user-name"
                className="field-input"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                autoComplete="name"
              />
            </Field>
            <Field label="Email address" htmlFor="user-email">
              <input
                id="user-email"
                type="email"
                className="field-input"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                autoComplete="email"
              />
            </Field>
            <Field label="Role" htmlFor="user-form-role">
              <select
                id="user-form-role"
                className="field-select"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
              >
                {(['ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'ENGINEER'] as Role[]).map((item) => (
                  <option key={item} value={item}>
                    {enumLabel(item)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Phone number" htmlFor="user-phone" hint="Used for SMS alert delivery.">
              <input
                id="user-phone"
                type="tel"
                className="field-input"
                placeholder="+233 24 000 0000"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                autoComplete="tel"
              />
            </Field>
            <Field
              label={editing ? 'New password' : 'Password'}
              htmlFor="user-password"
              hint={editing ? 'Leave blank to keep the current password.' : 'At least 8 characters with a letter and number.'}
              className="sm:col-span-2"
            >
              <input
                id="user-password"
                type="password"
                className="field-input"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              checked={form.smsOptIn}
              onChange={(checked) => setForm({ ...form, smsOptIn: checked })}
              label="SMS alerts"
              hint="Receive operational alerts by text message."
            />
            <Toggle
              checked={form.inAppOptIn}
              onChange={(checked) => setForm({ ...form, inAppOptIn: checked })}
              label="In-app alerts"
              hint="Receive alerts in the notification panel."
            />
            <Toggle
              checked={form.isFallbackContact}
              onChange={(checked) => setForm({ ...form, isFallbackContact: checked })}
              label="Fallback contact"
              hint="May be assigned to drains when a primary responder is unavailable."
            />
            <Toggle
              checked={form.active}
              onChange={(checked) => setForm({ ...form, active: checked })}
              label="Account active"
              hint="Inactive users cannot sign in."
            />
          </div>
        </div>
      </Modal>

      <AssignmentsPanel
        user={assignmentUser}
        onClose={() => setAssignmentUser(null)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
          setAssignmentUser(null);
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        confirmLabel={confirm?.label}
        loading={confirming}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function AssignmentsPanel({
  user,
  onClose,
  onSaved,
}: {
  user: UserWithAssignments | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [drainIds, setDrainIds] = useState<string[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [zoneInput, setZoneInput] = useState('');
  const [drainSearch, setDrainSearch] = useState('');
  const [initialized, setInitialized] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['admin', 'user', user?.id],
    queryFn: () => api.get<{ data: UserWithAssignments }>(`/api/users/${user?.id}`),
    enabled: Boolean(user),
  });

  const drainsQuery = useQuery({
    queryKey: ['admin', 'drains', 'all'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 200 }),
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (!user || initialized === user.id || !detailQuery.data) return;
    const assignments = detailQuery.data.data.assignments;
    setDrainIds(assignments.map((item) => item.drainId).filter((value): value is string => Boolean(value)));
    setZones(assignments.map((item) => item.zone).filter((value): value is string => Boolean(value)));
    setInitialized(user.id);
  }, [user, detailQuery.data, initialized]);

  const drains = drainsQuery.data?.data ?? [];
  const availableZones = [...new Set(drains.map((drain) => drain.zone))].sort();
  const filteredDrains = drains.filter((drain) => {
    const query = drainSearch.trim().toLowerCase();
    if (!query) return true;
    return drain.name.toLowerCase().includes(query) || drain.zone.toLowerCase().includes(query);
  });

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await api.put(`/api/users/${user.id}/assignments`, { drainIds, zones });
      toast('Assignments saved.', 'success');
      onSaved();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidePanel
      open={Boolean(user)}
      onClose={onClose}
      title="Assignments"
      description={user ? `${user.name} · ${enumLabel(user.role)}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Save assignments
          </Button>
        </>
      }
    >
      {detailQuery.isLoading || drainsQuery.isLoading ? (
        <LoadingState rows={6} />
      ) : detailQuery.isError || drainsQuery.isError ? (
        <ErrorState message={errorMessage(detailQuery.error ?? drainsQuery.error)} />
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Zone coverage</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Zone assignments let this user see all drains in a zone and receive the associated task notifications.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                className="field-input"
                list="assignment-zones"
                placeholder="Add a zone"
                value={zoneInput}
                onChange={(event) => setZoneInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const value = zoneInput.trim();
                    if (value && !zones.includes(value)) setZones([...zones, value]);
                    setZoneInput('');
                  }
                }}
              />
              <datalist id="assignment-zones">
                {availableZones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              <Button
                variant="secondary"
                onClick={() => {
                  const value = zoneInput.trim();
                  if (value && !zones.includes(value)) setZones([...zones, value]);
                  setZoneInput('');
                }}
              >
                Add
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {zones.length ? (
                zones.map((zone) => (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => setZones(zones.filter((item) => item !== zone))}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                    title="Remove zone"
                  >
                    {zone} <span aria-hidden>×</span>
                  </button>
                ))
              ) : (
                <span className="text-xs text-slate-400">No zone assignments</span>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Drain assignments</h3>
                <p className="mt-1 text-xs text-slate-500">{drainIds.length} drains selected</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDrainIds(drains.map((drain) => drain.id))}>
                  Select all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDrainIds([])}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="mt-3">
              <input
                className="field-input mb-3"
                placeholder="Filter drains"
                value={drainSearch}
                onChange={(event) => setDrainSearch(event.target.value)}
              />
              <div className="max-h-[340px] space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {filteredDrains.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">No drains match this filter.</p>
                ) : null}
                {filteredDrains.map((drain) => {
                  const checked = drainIds.includes(drain.id);
                  return (
                    <label
                      key={drain.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition',
                        checked ? 'bg-brand-50' : 'hover:bg-slate-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={checked}
                        onChange={(event) =>
                          setDrainIds(
                            event.target.checked
                              ? [...drainIds, drain.id]
                              : drainIds.filter((id) => id !== drain.id),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{drain.name}</span>
                        <span className="block text-xs text-slate-500">{drain.zone}</span>
                      </span>
                      <DrainStatusBadge status={drain.status} />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            Zone assignments and direct drain assignments can both be used. Saving replaces the existing assignment set.
          </p>
        </div>
      )}
    </SidePanel>
  );
}

interface DrainFormState {
  name: string;
  zone: string;
  latitude: string;
  longitude: string;
  address: string;
  status: DrainStatus;
  fallbackContactId: string;
}

const emptyDrainForm: DrainFormState = {
  name: '',
  zone: '',
  latitude: '',
  longitude: '',
  address: '',
  status: 'ACTIVE',
  fallbackContactId: '',
};

function DrainsAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');
  const [status, setStatus] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DrainListItem | null>(null);
  const [form, setForm] = useState<DrainFormState>(emptyDrainForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    label: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const drainsQuery = useQuery({
    queryKey: ['admin', 'drains', page, debouncedSearch, zone, status],
    queryFn: () =>
      api.get<Paginated<DrainListItem>>('/api/drains', {
        page,
        pageSize: 12,
        q: debouncedSearch || undefined,
        zone: zone || undefined,
        status: status || undefined,
      }),
  });

  const allDrainsQuery = useQuery({
    queryKey: ['admin', 'drains', 'zones'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 200 }),
  });

  const contactsQuery = useQuery({
    queryKey: ['admin', 'users', 'fallback'],
    queryFn: () => api.get<Paginated<UserWithAssignments>>('/api/users', { pageSize: 100, active: 'true' }),
  });

  const zones = [...new Set((allDrainsQuery.data?.data ?? []).map((drain) => drain.zone))].sort();
  const contacts = contactsQuery.data?.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(emptyDrainForm);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (drain: DrainListItem) => {
    setEditing(drain);
    setForm({
      name: drain.name,
      zone: drain.zone,
      latitude: String(drain.latitude),
      longitude: String(drain.longitude),
      address: drain.address ?? '',
      status: drain.status,
      fallbackContactId: drain.fallbackContactId ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setFormError(null);
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (!form.name.trim() || !form.zone.trim()) {
      setFormError('Name and zone are required.');
      return;
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      setFormError('Latitude must be between -90 and 90.');
      return;
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setFormError('Longitude must be between -180 and 180.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        zone: form.zone.trim(),
        latitude,
        longitude,
        address: form.address.trim() || null,
        status: form.status,
        fallbackContactId: form.fallbackContactId || null,
      };
      if (editing) {
        await api.patch(`/api/drains/${editing.id}`, body);
        toast('Drain updated.', 'success');
      } else {
        await api.post('/api/drains', body);
        toast('Drain added to the register.', 'success');
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'drains'] });
      setFormOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = (drain: DrainListItem) => {
    setConfirm({
      title: 'Deactivate drain?',
      description: `${drain.name} will be marked inactive. Monitoring history is retained and the drain can be reactivated later.`,
      label: 'Deactivate',
      action: async () => {
        await api.delete(`/api/drains/${drain.id}`);
        await queryClient.invalidateQueries({ queryKey: ['admin', 'drains'] });
        toast('Drain deactivated.', 'success');
      },
    });
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirming(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="field-label" htmlFor="drain-search">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="drain-search"
                className="field-input pl-9"
                placeholder="Name, address or zone"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <div className="w-40">
            <label className="field-label" htmlFor="drain-zone-filter">
              Zone
            </label>
            <select
              id="drain-zone-filter"
              className="field-select"
              value={zone}
              onChange={(event) => {
                setZone(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All zones</option>
              {zones.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="field-label" htmlFor="drain-status-filter">
              Status
            </label>
            <select
              id="drain-status-filter"
              className="field-select"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <Button icon={Plus} onClick={openCreate}>
            Add drain
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Drain register</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {drainsQuery.data ? `${formatNumber(drainsQuery.data.meta.total)} drains` : 'Loading drains'}
            </p>
          </div>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void drainsQuery.refetch()}>
            Refresh
          </Button>
        </div>
        {drainsQuery.isLoading ? (
          <LoadingState rows={6} />
        ) : drainsQuery.isError ? (
          <ErrorState message={errorMessage(drainsQuery.error)} onRetry={() => void drainsQuery.refetch()} />
        ) : drainsQuery.data?.data.length ? (
          <>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Drain</th>
                    <th>Zone</th>
                    <th>Status</th>
                    <th>Devices</th>
                    <th>Open alerts</th>
                    <th>Fallback contact</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drainsQuery.data.data.map((drain) => (
                    <tr key={drain.id}>
                      <td>
                        <Link to={`/drains/${drain.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {drain.name}
                        </Link>
                        <p className="text-xs text-slate-400">{drain.address ?? 'No address'}</p>
                      </td>
                      <td>{drain.zone}</td>
                      <td>
                        <DrainStatusBadge status={drain.status} />
                      </td>
                      <td>
                        <span className="text-xs text-slate-600">{drain.devices.length}</span>
                      </td>
                      <td>
                        <Badge tone={drain.alerts.length ? 'red' : 'slate'}>{drain.alerts.length}</Badge>
                      </td>
                      <td>
                        <span className="text-xs text-slate-600">{drain.fallbackContact?.name ?? '—'}</span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Link to={`/drains/${drain.id}`} className="table-action" title="Open drain">
                            <Wrench className="h-3.5 w-3.5" />
                          </Link>
                          <button type="button" className="table-action" onClick={() => openEdit(drain)} title="Edit drain">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {drain.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              className="table-action hover:text-red-600"
                              onClick={() => deactivate(drain)}
                              title="Deactivate drain"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <Pagination
                page={drainsQuery.data.meta.page}
                totalPages={drainsQuery.data.meta.totalPages}
                total={drainsQuery.data.meta.total}
                onPageChange={setPage}
              />
            </div>
          </>
        ) : (
          <EmptyState
            title="No drains found"
            description="Adjust the filters or add a drain to the register."
            icon={MapPin}
            action={<Button size="sm" icon={Plus} onClick={openCreate}>Add drain</Button>}
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit drain' : 'Add drain'}
        description={editing ? `Update ${editing.name}. Thresholds are managed from the drain detail page.` : 'Register a new drainage asset.'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} icon={editing ? Check : Plus} onClick={() => void save()}>
              {editing ? 'Save changes' : 'Add drain'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <FormError>{formError}</FormError> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Drain name" htmlFor="drain-name">
              <input
                id="drain-name"
                className="field-input"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="Zone" htmlFor="drain-zone">
              <input
                id="drain-zone"
                className="field-input"
                list="drain-zones"
                value={form.zone}
                onChange={(event) => setForm({ ...form, zone: event.target.value })}
              />
              <datalist id="drain-zones">
                {zones.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="Latitude" htmlFor="drain-latitude" hint="-90 to 90">
              <input
                id="drain-latitude"
                type="number"
                step="any"
                className="field-input"
                value={form.latitude}
                onChange={(event) => setForm({ ...form, latitude: event.target.value })}
              />
            </Field>
            <Field label="Longitude" htmlFor="drain-longitude" hint="-180 to 180">
              <input
                id="drain-longitude"
                type="number"
                step="any"
                className="field-input"
                value={form.longitude}
                onChange={(event) => setForm({ ...form, longitude: event.target.value })}
              />
            </Field>
            <Field label="Address" htmlFor="drain-address" className="sm:col-span-2">
              <input
                id="drain-address"
                className="field-input"
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </Field>
            <Field label="Status" htmlFor="drain-form-status">
              <select
                id="drain-form-status"
                className="field-select"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as DrainStatus })}
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </Field>
            <Field label="Fallback contact" htmlFor="drain-fallback" hint="Contact used when primary notification recipients are unavailable.">
              <select
                id="drain-fallback"
                className="field-select"
                value={form.fallbackContactId}
                onChange={(event) => setForm({ ...form, fallbackContactId: event.target.value })}
              >
                <option value="">No fallback contact</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} · {enumLabel(contact.role)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            Threshold configuration is available from the drain detail page after the drain is created.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        confirmLabel={confirm?.label}
        loading={confirming}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

interface DeviceFormState {
  drainId: string;
  name: string;
  type: DeviceType;
  serialNumber: string;
  firmwareVersion: string;
  batteryPercent: string;
  healthStatus: DeviceHealth;
  healthReason: string;
}

const emptyDeviceForm: DeviceFormState = {
  drainId: '',
  name: '',
  type: 'WATER_UPSTREAM',
  serialNumber: '',
  firmwareVersion: '',
  batteryPercent: '',
  healthStatus: 'UNKNOWN',
  healthReason: '',
};

function DevicesAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [health, setHealth] = useState('');
  const [drainFilter, setDrainFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceSummary | null>(null);
  const [form, setForm] = useState<DeviceFormState>(emptyDeviceForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<{ title: string; device: string; key: string } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    label: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const devicesQuery = useQuery({
    queryKey: ['admin', 'devices', page, health, drainFilter],
    queryFn: () =>
      api.get<Paginated<DeviceSummary>>('/api/devices', {
        page,
        pageSize: 12,
        healthStatus: health || undefined,
        drainId: drainFilter || undefined,
      }),
  });

  const drainsQuery = useQuery({
    queryKey: ['admin', 'drains', 'device-list'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 200 }),
  });

  const drains = drainsQuery.data?.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyDeviceForm, drainId: drains[0]?.id ?? '' });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (device: DeviceSummary) => {
    setEditing(device);
    setForm({
      drainId: device.drainId,
      name: device.name,
      type: device.type,
      serialNumber: device.serialNumber,
      firmwareVersion: device.firmwareVersion ?? '',
      batteryPercent: device.batteryPercent !== null ? String(device.batteryPercent) : '',
      healthStatus: device.healthStatus,
      healthReason: device.healthReason ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setFormError(null);
    if (!form.drainId) {
      setFormError('Select the drain this device monitors.');
      return;
    }
    if (!form.name.trim()) {
      setFormError('Device name is required.');
      return;
    }
    const battery = form.batteryPercent === '' ? null : Number(form.batteryPercent);
    if (battery !== null && (!Number.isFinite(battery) || battery < 0 || battery > 100)) {
      setFormError('Battery must be between 0 and 100.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/devices/${editing.id}`, {
          name: form.name.trim(),
          healthStatus: form.healthStatus,
          healthReason: form.healthStatus === 'HEALTHY' ? null : form.healthReason.trim() || null,
          firmwareVersion: form.firmwareVersion.trim() || null,
          batteryPercent: battery,
        });
        toast('Device updated.', 'success');
      } else {
        const response = await api.post<{ data: DeviceSummary; apiKey: string; notice: string }>('/api/devices', {
          drainId: form.drainId,
          name: form.name.trim(),
          type: form.type,
          serialNumber: form.serialNumber.trim() || undefined,
          firmwareVersion: form.firmwareVersion.trim() || undefined,
          batteryPercent: battery ?? undefined,
        });
        setSecret({
          title: 'Device registered',
          device: `${response.data.name} · ${response.data.serialNumber}`,
          key: response.apiKey,
        });
        toast('Device registered. Store the API key securely.', 'success');
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'devices'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'drains'] });
      setFormOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const rotateKey = (device: DeviceSummary) => {
    setConfirm({
      title: 'Rotate device API key?',
      description: `The current key for ${device.name} will stop working immediately. Update the simulator or device configuration with the new key.`,
      label: 'Rotate key',
      action: async () => {
        const response = await api.post<{ data: DeviceSummary; apiKey: string; notice: string }>(
          `/api/devices/${device.id}/rotate-key`,
        );
        setSecret({ title: 'API key rotated', device: `${response.data.name} · ${response.data.serialNumber}`, key: response.apiKey });
        await queryClient.invalidateQueries({ queryKey: ['admin', 'devices'] });
        toast('Device API key rotated.', 'success');
      },
    });
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirming(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setConfirming(false);
    }
  };

  const copyKey = async () => {
    if (!secret) return;
    try {
      await copyText(secret.key);
      toast('API key copied.', 'success');
    } catch {
      toast('Could not copy the API key.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="field-label" htmlFor="device-drain-filter">
              Drain
            </label>
            <select
              id="device-drain-filter"
              className="field-select"
              value={drainFilter}
              onChange={(event) => {
                setDrainFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All drains</option>
              {drains.map((drain) => (
                <option key={drain.id} value={drain.id}>
                  {drain.name} · {drain.zone}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="field-label" htmlFor="device-health-filter">
              Health
            </label>
            <select
              id="device-health-filter"
              className="field-select"
              value={health}
              onChange={(event) => {
                setHealth(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All health states</option>
              {(['HEALTHY', 'FAULTY', 'OFFLINE', 'UNKNOWN'] as DeviceHealth[]).map((state) => (
                <option key={state} value={state}>
                  {enumLabel(state)}
                </option>
              ))}
            </select>
          </div>
          <Button icon={Plus} onClick={openCreate} disabled={!drains.length}>
            Add device
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Monitoring devices</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {devicesQuery.data ? `${formatNumber(devicesQuery.data.meta.total)} devices` : 'Loading devices'}
            </p>
          </div>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void devicesQuery.refetch()}>
            Refresh
          </Button>
        </div>
        {devicesQuery.isLoading ? (
          <LoadingState rows={6} />
        ) : devicesQuery.isError ? (
          <ErrorState message={errorMessage(devicesQuery.error)} onRetry={() => void devicesQuery.refetch()} />
        ) : devicesQuery.data?.data.length ? (
          <>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Drain</th>
                    <th>Type</th>
                    <th>Key prefix</th>
                    <th>Health</th>
                    <th>Last seen</th>
                    <th>Battery</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devicesQuery.data.data.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <p className="font-medium text-slate-900">{device.name}</p>
                        <p className="text-[11px] text-slate-400">{device.serialNumber}</p>
                      </td>
                      <td>
                        <span className="text-xs text-slate-600">{device.drain?.name ?? '—'}</span>
                        <p className="text-[11px] text-slate-400">{device.drain?.zone}</p>
                      </td>
                      <td>
                        <Badge tone="slate">{enumLabel(device.type)}</Badge>
                      </td>
                      <td>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{device.apiKeyPrefix}…</code>
                      </td>
                      <td>
                        <DeviceHealthBadge health={device.healthStatus} />
                      </td>
                      <td>
                        <span className="text-xs text-slate-500">
                          {device.lastSeenAt ? formatRelative(device.lastSeenAt) : 'Never'}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-slate-600">
                          {device.batteryPercent !== null ? `${formatNumber(device.batteryPercent)}%` : '—'}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button type="button" className="table-action" onClick={() => openEdit(device)} title="Edit device">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="table-action hover:text-amber-600"
                            onClick={() => rotateKey(device)}
                            title="Rotate API key"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <Pagination
                page={devicesQuery.data.meta.page}
                totalPages={devicesQuery.data.meta.totalPages}
                total={devicesQuery.data.meta.total}
                onPageChange={setPage}
              />
            </div>
          </>
        ) : (
          <EmptyState
            title="No devices found"
            description={drains.length ? 'Adjust the filters or register a device.' : 'Add a drain before registering a device.'}
            icon={Wifi}
            action={drains.length ? <Button size="sm" icon={Plus} onClick={openCreate}>Add device</Button> : undefined}
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit device' : 'Register device'}
        description={editing ? `Update ${editing.name}. Health changes are recorded for operations.` : 'Register a sensor and generate its API key.'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} icon={editing ? Check : Plus} onClick={() => void save()}>
              {editing ? 'Save changes' : 'Register device'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <FormError>{formError}</FormError> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Drain" htmlFor="device-drain" className="sm:col-span-2">
              <select
                id="device-drain"
                className="field-select"
                value={form.drainId}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, drainId: event.target.value })}
              >
                <option value="">Select a drain</option>
                {drains.map((drain) => (
                  <option key={drain.id} value={drain.id}>
                    {drain.name} · {drain.zone}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Device name" htmlFor="device-name">
              <input
                id="device-name"
                className="field-input"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="Sensor type" htmlFor="device-type">
              <select
                id="device-type"
                className="field-select"
                value={form.type}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, type: event.target.value as DeviceType })}
              >
                <option value="WATER_UPSTREAM">Water upstream</option>
                <option value="WATER_DOWNSTREAM">Water downstream</option>
                <option value="LITTER">Litter</option>
              </select>
            </Field>
            <Field label="Serial number" htmlFor="device-serial" hint={editing ? undefined : 'Leave blank to generate automatically.'}>
              <input
                id="device-serial"
                className="field-input"
                value={form.serialNumber}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, serialNumber: event.target.value })}
              />
            </Field>
            <Field label="Firmware version" htmlFor="device-firmware">
              <input
                id="device-firmware"
                className="field-input"
                value={form.firmwareVersion}
                onChange={(event) => setForm({ ...form, firmwareVersion: event.target.value })}
              />
            </Field>
            <Field label="Battery percent" htmlFor="device-battery">
              <input
                id="device-battery"
                type="number"
                min="0"
                max="100"
                className="field-input"
                value={form.batteryPercent}
                onChange={(event) => setForm({ ...form, batteryPercent: event.target.value })}
              />
            </Field>
            {editing ? (
              <>
                <Field label="Health status" htmlFor="device-health">
                  <select
                    id="device-health"
                    className="field-select"
                    value={form.healthStatus}
                    onChange={(event) => setForm({ ...form, healthStatus: event.target.value as DeviceHealth })}
                  >
                    {(['HEALTHY', 'FAULTY', 'OFFLINE', 'UNKNOWN'] as DeviceHealth[]).map((state) => (
                      <option key={state} value={state}>
                        {enumLabel(state)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Health reason" htmlFor="device-health-reason" className="sm:col-span-2">
                  <input
                    id="device-health-reason"
                    className="field-input"
                    value={form.healthReason}
                    onChange={(event) => setForm({ ...form, healthReason: event.target.value })}
                  />
                </Field>
              </>
            ) : null}
          </div>
          {!editing ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              The device API key is shown once after registration. Store it securely before closing the dialog.
            </p>
          ) : null}
        </div>
      </Modal>

      <SecretModal secret={secret} onClose={() => setSecret(null)} onCopy={() => void copyKey()} />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        confirmLabel={confirm?.label}
        loading={confirming}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function SecretModal({
  secret,
  onClose,
  onCopy,
}: {
  secret: { title: string; device: string; key: string } | null;
  onClose: () => void;
  onCopy: () => void;
}) {
  return (
    <Modal
      open={Boolean(secret)}
      onClose={onClose}
      title={secret?.title ?? 'API key'}
      description={secret?.device}
      size="md"
      footer={
        <Button onClick={onClose}>Done</Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          <KeyRound className="mt-1 h-4 w-4 shrink-0" />
          <p>This key is shown once and cannot be retrieved later. Store it in the device or simulator environment securely.</p>
        </div>
        <div>
          <p className="field-label">Device API key</p>
          <div className="flex gap-2">
            <input className="field-input font-mono text-xs" readOnly value={secret?.key ?? ''} />
            <Button variant="secondary" icon={Copy} onClick={onCopy}>
              Copy
            </Button>
          </div>
        </div>
        <p className="text-xs leading-5 text-slate-500">
          Use this key as the <code className="rounded bg-slate-100 px-1">X-Device-Key</code> header when sending readings.
        </p>
      </div>
    </Modal>
  );
}

interface RainfallFormState {
  zone: string;
  mmPerHour: string;
  recordedAt: string;
  source: RainfallSource;
  notes: string;
}

function RainfallAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RainfallFormState>({
    zone: '',
    mmPerHour: '',
    recordedAt: toDateTimeLocal(new Date()),
    source: 'MANUAL',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const drainsQuery = useQuery({
    queryKey: ['admin', 'drains', 'rainfall-zones'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 200 }),
  });

  const readingsQuery = useQuery({
    queryKey: ['admin', 'rainfall', page],
    queryFn: () => api.get<Paginated<RainfallReading>>('/api/rainfall', { page, pageSize: 12 }),
  });

  const zones = [...new Set((drainsQuery.data?.data ?? []).map((drain) => drain.zone))].sort();

  const save = async () => {
    setError(null);
    const mmPerHour = Number(form.mmPerHour);
    if (!form.zone.trim()) {
      setError('Zone is required.');
      return;
    }
    if (!Number.isFinite(mmPerHour) || mmPerHour < 0 || mmPerHour > 1000) {
      setError('Rainfall must be between 0 and 1000 mm/h.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/rainfall', {
        zone: form.zone.trim(),
        mmPerHour,
        recordedAt: form.recordedAt ? new Date(form.recordedAt).toISOString() : undefined,
        source: form.source,
        notes: form.notes.trim() || undefined,
      });
      toast('Rainfall observation recorded.', 'success');
      setForm({ ...form, mmPerHour: '', notes: '', recordedAt: toDateTimeLocal(new Date()) });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'rainfall'] });
      setPage(1);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.5fr]">
      <Card>
        <CardHeader
          title="Record rainfall"
          description="Add a manual or weather-service observation for a zone."
        />
        <div className="mt-5 space-y-4">
          {error ? <FormError>{error}</FormError> : null}
          <Field label="Zone" htmlFor="rainfall-zone">
            <input
              id="rainfall-zone"
              className="field-input"
              list="rainfall-zones"
              placeholder="Select or enter a zone"
              value={form.zone}
              onChange={(event) => setForm({ ...form, zone: event.target.value })}
            />
            <datalist id="rainfall-zones">
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </Field>
          <Field label="Rainfall intensity" htmlFor="rainfall-mm" hint="Millimetres per hour at the recorded time.">
            <div className="relative">
              <input
                id="rainfall-mm"
                type="number"
                min="0"
                max="1000"
                step="0.1"
                className="field-input pr-16"
                value={form.mmPerHour}
                onChange={(event) => setForm({ ...form, mmPerHour: event.target.value })}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">mm/h</span>
            </div>
          </Field>
          <Field label="Recorded at" htmlFor="rainfall-recorded">
            <input
              id="rainfall-recorded"
              type="datetime-local"
              className="field-input"
              value={form.recordedAt}
              onChange={(event) => setForm({ ...form, recordedAt: event.target.value })}
            />
          </Field>
          <Field label="Source" htmlFor="rainfall-source">
            <select
              id="rainfall-source"
              className="field-select"
              value={form.source}
              onChange={(event) => setForm({ ...form, source: event.target.value as RainfallSource })}
            >
              <option value="MANUAL">Manual observation</option>
              <option value="WEATHER_API">Weather API</option>
              <option value="SENSOR">Rain sensor</option>
            </select>
          </Field>
          <Field label="Notes" htmlFor="rainfall-notes">
            <textarea
              id="rainfall-notes"
              rows={3}
              className="field-input resize-y"
              placeholder="Optional observation notes"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
          <Button className="w-full" icon={CloudRain} loading={saving} onClick={() => void save()}>
            Record rainfall
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent rainfall readings</h2>
            <p className="mt-0.5 text-xs text-slate-500">Latest observations across all zones</p>
          </div>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void readingsQuery.refetch()}>
            Refresh
          </Button>
        </div>
        {readingsQuery.isLoading ? (
          <LoadingState rows={6} />
        ) : readingsQuery.isError ? (
          <ErrorState message={errorMessage(readingsQuery.error)} onRetry={() => void readingsQuery.refetch()} />
        ) : readingsQuery.data?.data.length ? (
          <>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Intensity</th>
                    <th>Source</th>
                    <th>Recorded</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {readingsQuery.data.data.map((reading) => (
                    <tr key={reading.id}>
                      <td>
                        <span className="font-medium text-slate-900">{reading.zone}</span>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                          <Droplets className="h-3.5 w-3.5 text-cyan-500" />
                          {formatNumber(reading.mmPerHour, 1)} mm/h
                        </span>
                      </td>
                      <td>
                        <Badge tone={reading.source === 'MANUAL' ? 'violet' : reading.source === 'SENSOR' ? 'blue' : 'slate'}>
                          {enumLabel(reading.source)}
                        </Badge>
                      </td>
                      <td>
                        <p className="text-xs text-slate-600">{formatDateTime(reading.recordedAt)}</p>
                        <p className="text-[11px] text-slate-400">Added {formatRelative(reading.receivedAt)}</p>
                      </td>
                      <td>
                        <span className="line-clamp-2 text-xs text-slate-500">{reading.notes ?? '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <Pagination
                page={readingsQuery.data.meta.page}
                totalPages={readingsQuery.data.meta.totalPages}
                total={readingsQuery.data.meta.total}
                onPageChange={setPage}
              />
            </div>
          </>
        ) : (
          <EmptyState
            title="No rainfall readings"
            description="Record the first observation using the form."
            icon={CloudRain}
          />
        )}
      </Card>
    </div>
  );
}
