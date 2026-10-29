import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  enumLabel,
  formatDateTime,
  formatNumber,
  formatRelative,
  titleCase,
} from '../lib/format';
import type {
  AlertDetail,
  AlertSeverity,
  AlertStatus,
  AlertSummary,
  AlertType,
  DrainListItem,
  Paginated,
} from '../lib/types';
import {
  AlertStatusBadge,
  AlertTypeBadge,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingState,
  Modal,
  NotificationStatusBadge,
  PageHeader,
  Pagination,
  SeverityBadge,
  SidePanel,
  Tabs,
  TaskStatusBadge,
  useToast,
} from '../components/ui';

const alertTypes: AlertType[] = [
  'BASKET_NEARLY_FULL',
  'HIGH_WATER',
  'POSSIBLE_BLOCKAGE',
  'SYSTEM_HEALTH',
  'ENGINEERING_REVIEW',
];

const severities: AlertSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];

function triggerEntries(data: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(data ?? {}).map(([key, value]) => {
    if (value === null || value === undefined) return [key, '—'];
    if (typeof value === 'object') return [key, JSON.stringify(value)];
    if (typeof value === 'boolean') return [key, value ? 'Yes' : 'No'];
    return [key, String(value)];
  });
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-700">{children}</span>
    </div>
  );
}

export function AlertsPage() {
  const { session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);

  const status = (searchParams.get('status') ?? '') as '' | AlertStatus;
  const severity = (searchParams.get('severity') ?? '') as '' | AlertSeverity;
  const type = (searchParams.get('type') ?? '') as '' | AlertType;
  const zone = searchParams.get('zone') ?? '';
  const drainId = searchParams.get('drainId') ?? '';
  const alertId = searchParams.get('alertId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const updateParam = (key: string, value: string, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (resetPage) next.delete('page');
    if (key !== 'alertId') next.delete('alertId');
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (alertId) next.set('alertId', alertId);
    setSearchParams(next, { replace: true });
  };

  const zonesQuery = useQuery({
    queryKey: ['drains', 'zones'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 100 }),
    staleTime: 120_000,
  });

  const zones = [...new Set((zonesQuery.data?.data ?? []).map((drain) => drain.zone))].sort();

  const alertsQuery = useQuery({
    queryKey: ['alerts', 'list', status, severity, type, zone, drainId, page],
    queryFn: () =>
      api.get<Paginated<AlertSummary>>('/api/alerts', {
        status: status || undefined,
        severity: severity || undefined,
        type: type || undefined,
        zone: zone || undefined,
        drainId: drainId || undefined,
        page,
        pageSize: 20,
      }),
  });

  const alertQuery = useQuery({
    queryKey: ['alert', alertId],
    queryFn: () => api.get<{ data: AlertDetail }>(`/api/alerts/${alertId}`),
    enabled: Boolean(alertId),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.post<{ data: AlertSummary }>(`/api/alerts/${id}/acknowledge`),
    onSuccess: (response) => {
      toast(`Alert acknowledged for ${response.data.drain?.name ?? 'drain'}.`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['alert', alertId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['drain'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: AlertSummary }>(`/api/alerts/${alertId}/resolve`, {
        resolutionNote: resolutionNote.trim(),
      }),
    onSuccess: () => {
      setResolveOpen(false);
      setResolutionNote('');
      setResolveError(null);
      toast('Alert resolved and recorded in the audit trail.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['alert', alertId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['drain'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (error) => setResolveError(errorMessage(error)),
  });

  const closeAlert = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('alertId');
    setSearchParams(next, { replace: true });
  };

  const openAlert = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('alertId', id);
    setSearchParams(next, { replace: true });
  };

  const alert = alertQuery.data?.data;
  const hasFilters = Boolean(status || severity || type || zone || drainId);
  const canCreateTask = session?.user.role === 'ADMIN' || session?.user.role === 'SUPERVISOR';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert queue"
        description="Acknowledge, investigate and resolve signals from the drainage rules. A possible blockage indicates the need for inspection, not a confirmed defect."
        eyebrow="Signal response"
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void alertsQuery.refetch()}>
            Refresh
          </Button>
        }
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={status}
            onChange={(value) => updateParam('status', value)}
            tabs={[
              { value: '', label: 'All statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
              { value: 'RESOLVED', label: 'Resolved' },
            ]}
          />
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <select
            className="field-select"
            value={type}
            onChange={(event) => updateParam('type', event.target.value)}
            aria-label="Filter by alert type"
          >
            <option value="">All alert types</option>
            {alertTypes.map((item) => (
              <option key={item} value={item}>
                {enumLabel(item)}
              </option>
            ))}
          </select>
          <select
            className="field-select"
            value={severity}
            onChange={(event) => updateParam('severity', event.target.value)}
            aria-label="Filter by severity"
          >
            <option value="">All severities</option>
            {severities.map((item) => (
              <option key={item} value={item}>
                {enumLabel(item)}
              </option>
            ))}
          </select>
          <select
            className="field-select"
            value={zone}
            onChange={(event) => updateParam('zone', event.target.value)}
            aria-label="Filter by zone"
          >
            <option value="">All zones</option>
            {zones.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Search className="h-3.5 w-3.5" />
            {drainId ? (
              <>
                <span>Drain filter active</span>
                <button
                  type="button"
                  onClick={() => updateParam('drainId', '')}
                  className="ml-auto font-semibold text-brand-700 hover:underline"
                >
                  Clear
                </button>
              </>
            ) : (
              <span>Use a drain page to filter its alert history.</span>
            )}
          </div>
        </div>
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Alerts</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatNumber(alertsQuery.data?.meta.total ?? 0)} matching signals
            </p>
          </div>
          <Badge tone="slate" dot>
            Status ordered by urgency
          </Badge>
        </div>

        {alertsQuery.isLoading ? (
          <LoadingState rows={7} />
        ) : alertsQuery.isError ? (
          <ErrorState message={errorMessage(alertsQuery.error)} onRetry={() => void alertsQuery.refetch()} />
        ) : !alertsQuery.data?.data.length ? (
          <EmptyState
            title="No alerts match"
            description="Adjust the filters or wait for the next rule evaluation."
            icon={ShieldCheck}
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Drain</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Raised</th>
                    <th>People</th>
                    <th className="text-right">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {alertsQuery.data.data.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => openAlert(item.id)}
                    >
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <AlertTypeBadge type={item.type} />
                          {item._count && item._count.tasks > 0 ? (
                            <Badge tone="slate">{item._count.tasks} task{item._count.tasks === 1 ? '' : 's'}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 max-w-[340px] truncate text-xs text-slate-500">
                          {item.message ?? item.rule}
                        </p>
                      </td>
                      <td>
                        <span className="font-medium text-slate-800">{item.drain?.name ?? '—'}</span>
                        <p className="mt-0.5 text-xs text-slate-400">{item.drain?.zone ?? ''}</p>
                      </td>
                      <td>
                        <SeverityBadge severity={item.severity} />
                      </td>
                      <td>
                        <AlertStatusBadge status={item.status} />
                      </td>
                      <td>
                        <span className="text-xs text-slate-500">{formatRelative(item.createdAt)}</span>
                        <p className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(item.createdAt)}</p>
                      </td>
                      <td>
                        <p className="text-xs text-slate-600">
                          {item.acknowledgedBy?.name ? `Ack: ${item.acknowledgedBy.name}` : 'Not acknowledged'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {item.resolvedBy?.name ? `Resolved: ${item.resolvedBy.name}` : 'Open'}
                        </p>
                      </td>
                      <td className="text-right">
                        <span className="text-xs font-semibold text-brand-700">Open</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-5 py-3">
              <Pagination
                page={alertsQuery.data.meta.page}
                totalPages={alertsQuery.data.meta.totalPages}
                total={alertsQuery.data.meta.total}
                onPageChange={(next) => updateParam('page', String(next), false)}
              />
            </div>
          </>
        )}
      </Card>

      <SidePanel
        open={Boolean(alertId)}
        onClose={closeAlert}
        title={alert ? enumLabel(alert.type) : 'Alert detail'}
        description={alert ? `${alert.drain.name} · ${alert.drain.zone}` : 'Loading alert record'}
        footer={
          alert ? (
            <>
              {alert.status === 'ACTIVE' ? (
                <Button
                  variant="secondary"
                  icon={CheckCircle2}
                  loading={acknowledgeMutation.isPending}
                  onClick={() => acknowledgeMutation.mutate(alert.id)}
                >
                  Acknowledge
                </Button>
              ) : null}
              {alert.status !== 'RESOLVED' ? (
                <Button
                  icon={CheckCircle2}
                  onClick={() => {
                    setResolveError(null);
                    setResolveOpen(true);
                  }}
                >
                  Resolve alert
                </Button>
              ) : null}
              {canCreateTask ? (
                <Link
                  to={`/tasks?create=1&drainId=${alert.drain.id}&alertId=${alert.id}`}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" /> Raise task
                </Link>
              ) : null}
            </>
          ) : null
        }
      >
        {alertQuery.isLoading ? (
          <LoadingState rows={5} />
        ) : alertQuery.isError ? (
          <ErrorState message={errorMessage(alertQuery.error)} onRetry={() => void alertQuery.refetch()} />
        ) : alert ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={alert.severity} />
              <AlertStatusBadge status={alert.status} />
              {alert._count ? <Badge tone="slate">{alert._count.notifications} notifications</Badge> : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm leading-6 text-slate-700">{alert.message ?? alert.rule}</p>
              <p className="mt-2 text-xs text-slate-400">Rule: {alert.rule}</p>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Drain</h3>
              <Link
                to={`/drains/${alert.drain.id}`}
                onClick={closeAlert}
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-brand-200 hover:bg-brand-50/40"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-brand-700 ring-1 ring-slate-200">
                  <MapPin className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{alert.drain.name}</p>
                  <p className="text-xs text-slate-500">
                    {alert.drain.zone}
                    {alert.drain.address ? ` · ${alert.drain.address}` : ''}
                  </p>
                </div>
              </Link>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Timeline</h3>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">Raised</p>
                    <p className="text-xs text-slate-500">{formatDateTime(alert.createdAt)}</p>
                  </div>
                </div>
                {alert.acknowledgedAt ? (
                  <div className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        Acknowledged by {alert.acknowledgedBy?.name ?? 'a responder'}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(alert.acknowledgedAt)}</p>
                    </div>
                  </div>
                ) : null}
                {alert.resolvedAt ? (
                  <div className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        Resolved by {alert.resolvedBy?.name ?? 'a responder'}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(alert.resolvedAt)}</p>
                      {alert.resolutionNote ? <p className="mt-1 text-xs text-slate-600">{alert.resolutionNote}</p> : null}
                    </div>
                  </div>
                ) : null}
                {alert.escalationDueAt ? (
                  <div className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Escalation due</p>
                      <p className="text-xs text-slate-500">{formatDateTime(alert.escalationDueAt)}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Trigger evidence</h3>
              <div className="rounded-xl border border-slate-200 px-3">
                {triggerEntries(alert.triggerData).length ? (
                  triggerEntries(alert.triggerData).map(([key, value]) => (
                    <DetailRow key={key} label={titleCase(key)}>
                      <span className="break-all">{value}</span>
                    </DetailRow>
                  ))
                ) : (
                  <p className="py-3 text-sm text-slate-400">No trigger data recorded.</p>
                )}
              </div>
            </div>

            {alert.tasks.length ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Linked tasks</h3>
                <div className="space-y-2">
                  {alert.tasks.map((task) => (
                    <Link
                      key={task.id}
                      to={`/tasks?taskId=${task.id}`}
                      onClick={closeAlert}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"
                    >
                      <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                        <p className="text-xs text-slate-500">{task.assignedTo?.name ?? 'Unassigned'}</p>
                      </div>
                      <TaskStatusBadge status={task.status} />
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Notifications</h3>
              {alert.notifications.length ? (
                <div className="space-y-2">
                  {alert.notifications.map((notification) => (
                    <div key={notification.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">
                          {enumLabel(notification.channel)} · {notification.recipient}
                        </span>
                        <NotificationStatusBadge status={notification.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {enumLabel(notification.kind)} · attempt {notification.attempt} · {formatRelative(notification.createdAt)}
                      </p>
                      {notification.error ? <p className="mt-1 text-xs text-red-600">{notification.error}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                  <MessageSquare className="h-4 w-4" />
                  No notifications recorded for this alert.
                </div>
              )}
            </div>

            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              Last updated {formatRelative(alert.updatedAt)}
            </p>
          </div>
        ) : null}
      </SidePanel>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Resolve alert"
        description="Record what was checked or done. This note becomes part of the audit trail."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)} disabled={resolveMutation.isPending}>
              Cancel
            </Button>
            <Button
              loading={resolveMutation.isPending}
              onClick={() => {
                setResolveError(null);
                if (!resolutionNote.trim()) {
                  setResolveError('A resolution note is required.');
                  return;
                }
                resolveMutation.mutate();
              }}
            >
              Resolve alert
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {resolveError ? <FormError>{resolveError}</FormError> : null}
          <Field label="Resolution note" htmlFor="resolution-note" hint="For example: inspected inlet, cleared litter and confirmed flow.">
            <textarea
              id="resolution-note"
              className="field-textarea"
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              maxLength={2000}
              required
            />
          </Field>
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Resolving closes the active signal. Use “acknowledge” while investigation is still in progress.
          </div>
        </div>
      </Modal>
    </div>
  );
}
