import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  ListChecks,
  MessageSquare,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce } from '../hooks/useDebounce';
import {
  cn,
  formatDateTime,
  formatNumber,
  formatRelative,
  formatUptime,
} from '../lib/format';
import type {
  AuditLog,
  DeviceSummary,
  Paginated,
  SystemHealth,
} from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DeviceHealthBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SidePanel,
  Tabs,
} from '../components/ui';

export function SystemPage() {
  const { session } = useAuth();
  const isAdmin = session?.user.role === 'ADMIN';
  const [auditPage, setAuditPage] = useState(1);
  const [auditAction, setAuditAction] = useState('');
  const [auditEntity, setAuditEntity] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [fleetView, setFleetView] = useState<'attention' | 'offline' | 'faulty'>('attention');

  const debouncedAction = useDebounce(auditAction, 350);
  const debouncedEntity = useDebounce(auditEntity, 350);

  const healthQuery = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.get<{ data: SystemHealth }>('/api/system/health'),
    refetchInterval: 30_000,
    retry: false,
  });

  const health = healthQuery.data?.data;

  const auditQuery = useQuery({
    queryKey: ['system', 'audit', auditPage, debouncedAction, debouncedEntity],
    queryFn: () =>
      api.get<Paginated<AuditLog>>('/api/system/audit-logs', {
        page: auditPage,
        pageSize: 15,
        action: debouncedAction || undefined,
        entityType: debouncedEntity || undefined,
      }),
    enabled: isAdmin,
  });

  const offlineQuery = useQuery({
    queryKey: ['devices', 'system-offline'],
    queryFn: () =>
      api.get<Paginated<DeviceSummary>>('/api/devices', {
        healthStatus: 'OFFLINE',
        pageSize: 8,
      }),
  });

  const faultyQuery = useQuery({
    queryKey: ['devices', 'system-faulty'],
    queryFn: () =>
      api.get<Paginated<DeviceSummary>>('/api/devices', {
        healthStatus: 'FAULTY',
        pageSize: 8,
      }),
  });

  const offline = offlineQuery.data?.data ?? [];
  const faulty = faultyQuery.data?.data ?? [];
  const offlineTotal = offlineQuery.data?.meta.total ?? 0;
  const faultyTotal = faultyQuery.data?.meta.total ?? 0;
  const attention = [...faulty, ...offline];
  const fleet =
    fleetView === 'offline' ? offline : fleetView === 'faulty' ? faulty : attention;

  const totalRecords = health
    ? Object.values(health.counts).reduce((sum, value) => sum + value, 0)
    : 0;

  const healthy = health?.status === 'ok' && health.checks.database.status === 'ok';

  return (
    <div className="space-y-6">
      <PageHeader
        title="System health"
        description="Monitor the DrainGuard API, database, job schedules and data footprint. Health is checked automatically every 30 seconds."
        eyebrow="Platform operations"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={healthQuery.isFetching}
            onClick={() => {
              void healthQuery.refetch();
              void offlineQuery.refetch();
              void faultyQuery.refetch();
            }}
          >
            Check now
          </Button>
        }
      />

      {healthQuery.isLoading ? (
        <Card padded={false}>
          <LoadingState rows={5} />
        </Card>
      ) : healthQuery.isError || !health ? (
        <Card>
          <ErrorState
            title="System health unavailable"
            message={errorMessage(healthQuery.error)}
            onRetry={() => void healthQuery.refetch()}
          />
        </Card>
      ) : (
        <>
          <Card className={cn(healthy ? 'border-emerald-200' : 'border-amber-300')}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span
                  className={cn(
                    'grid h-12 w-12 shrink-0 place-items-center rounded-2xl',
                    healthy ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
                  )}
                >
                  {healthy ? <ShieldCheck className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">
                      {healthy ? 'All systems operational' : 'Degraded operation'}
                    </h2>
                    <Badge tone={healthy ? 'green' : 'amber'} dot>
                      {health.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {health.service} v{health.version} · {health.environment} · checked{' '}
                    {formatRelative(health.timestamp)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Database</p>
                  <p className={cn('font-semibold', health.checks.database.status === 'ok' ? 'text-emerald-700' : 'text-red-600')}>
                    {health.checks.database.status === 'ok' ? 'Connected' : 'Unavailable'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Latency</p>
                  <p className="font-semibold text-slate-800">
                    {health.checks.database.latencyMs !== null ? `${health.checks.database.latencyMs} ms` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Uptime</p>
                  <p className="font-semibold text-slate-800">{formatUptime(health.uptimeSeconds)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">SMS provider</p>
                  <p className="font-semibold text-slate-800">{health.smsProvider}</p>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Records stored</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{formatNumber(totalRecords)}</p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">
                  <Database className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {formatNumber(health.counts.readings)} readings · {formatNumber(health.counts.alerts)} alerts
              </p>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Devices requiring attention</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{formatNumber(faultyTotal + offlineTotal)}</p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
                  <WifiOff className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {formatNumber(faultyTotal)} faulty · {formatNumber(offlineTotal)} offline
              </p>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Scheduled jobs</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                    {health.jobs.enabled ? 'Active' : 'Paused'}
                  </p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <Clock className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {health.jobs.enabled ? 'Automated monitoring and escalation running' : 'Background processing is disabled'}
              </p>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Notifications</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{formatNumber(health.counts.notifications)}</p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600">
                  <MessageSquare className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">SMS and in-app delivery records</p>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <Card>
              <CardHeader title="Data footprint" description="Current records across the operational database" />
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Users', health.counts.users, Activity],
                  ['Drains', health.counts.drains, HardDrive],
                  ['Devices', health.counts.devices, Radio],
                  ['Readings', health.counts.readings, ListChecks],
                  ['Rainfall', health.counts.rainfall, Server],
                  ['Alerts', health.counts.alerts, AlertTriangle],
                  ['Tasks', health.counts.tasks, CheckCircle2],
                  ['Notifications', health.counts.notifications, MessageSquare],
                ].map(([label, value, Icon]) => {
                  const IconComponent = Icon as typeof Activity;
                  return (
                    <div key={label as string} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                      <IconComponent className="h-4 w-4 text-slate-400" />
                      <p className="mt-2 text-lg font-semibold tabular-nums text-slate-900">{formatNumber(value as number)}</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label as string}</p>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader title="Job schedule" description="Background processing configuration" />
              <div className="mt-4 divide-y divide-slate-100">
                {[
                  ['Rule sweep', health.jobs.rulesCron, 'Evaluates sensor and rainfall rules'],
                  ['Offline detection', health.jobs.offlineCron, 'Marks silent devices offline'],
                  ['Notification retry', health.jobs.notificationRetryCron, 'Retries failed SMS delivery'],
                  ['Escalation', health.jobs.escalationCron, 'Escalates unacknowledged alerts'],
                ].map(([label, cron, description]) => (
                  <div key={label} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{label}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
                    </div>
                    <code className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                      {cron}
                    </code>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card padded={false}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Device fleet attention</h2>
                <p className="mt-0.5 text-xs text-slate-500">Faulty and offline devices that may affect monitoring coverage</p>
              </div>
              <Tabs
                value={fleetView}
                onChange={(value) => setFleetView(value as 'attention' | 'offline' | 'faulty')}
                tabs={[
                  { value: 'attention', label: 'All', count: faultyTotal + offlineTotal },
                  { value: 'faulty', label: 'Faulty', count: faultyTotal },
                  { value: 'offline', label: 'Offline', count: offlineTotal },
                ]}
              />
            </div>
            {offlineQuery.isLoading || faultyQuery.isLoading ? (
              <LoadingState rows={4} />
            ) : offlineQuery.isError || faultyQuery.isError ? (
              <ErrorState
                message={errorMessage(offlineQuery.error ?? faultyQuery.error)}
                onRetry={() => {
                  void offlineQuery.refetch();
                  void faultyQuery.refetch();
                }}
              />
            ) : fleet.length === 0 ? (
              <EmptyState
                title="No devices need attention"
                description="All registered devices are reporting healthy."
                icon={CheckCircle2}
              />
            ) : (
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Drain</th>
                      <th>Health</th>
                      <th>Reason</th>
                      <th>Last seen</th>
                      <th className="text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fleet.map((device) => (
                      <tr key={device.id}>
                        <td>
                          <p className="font-medium text-slate-900">{device.name}</p>
                          <p className="text-[11px] text-slate-400">{device.serialNumber}</p>
                        </td>
                        <td>
                          <span className="text-slate-700">{device.drain?.name ?? '—'}</span>
                          <p className="text-xs text-slate-400">{device.drain?.zone}</p>
                        </td>
                        <td>
                          <DeviceHealthBadge health={device.healthStatus} />
                        </td>
                        <td>
                          <span className="line-clamp-2 text-xs text-slate-500">{device.healthReason ?? '—'}</span>
                        </td>
                        <td>
                          <span className="text-xs text-slate-500">
                            {device.lastSeenAt ? formatRelative(device.lastSeenAt) : 'Never'}
                          </span>
                        </td>
                        <td className="text-right">
                          {device.drain ? (
                            <Link to={`/drains/${device.drain.id}`} className="text-xs font-semibold text-brand-700 hover:underline">
                              Open drain
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {isAdmin ? (
            <Card padded={false}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Audit trail</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Administrative and security-relevant activity</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="field-input h-9 w-40 text-xs"
                    placeholder="Filter action"
                    value={auditAction}
                    onChange={(event) => {
                      setAuditAction(event.target.value);
                      setAuditPage(1);
                    }}
                  />
                  <input
                    className="field-input h-9 w-36 text-xs"
                    placeholder="Entity type"
                    value={auditEntity}
                    onChange={(event) => {
                      setAuditEntity(event.target.value);
                      setAuditPage(1);
                    }}
                  />
                </div>
              </div>
              {auditQuery.isLoading ? (
                <LoadingState rows={5} />
              ) : auditQuery.isError ? (
                <ErrorState message={errorMessage(auditQuery.error)} onRetry={() => void auditQuery.refetch()} />
              ) : auditQuery.data?.data.length ? (
                <>
                  <div className="table-shell">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Actor</th>
                          <th>Entity</th>
                          <th>IP</th>
                          <th>When</th>
                          <th className="text-right">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditQuery.data.data.map((log) => (
                          <tr key={log.id}>
                            <td>
                              <span className="font-mono text-xs font-medium text-slate-800">{log.action}</span>
                            </td>
                            <td>
                              <p className="text-sm text-slate-700">{log.actor?.name ?? 'System'}</p>
                              <p className="text-[11px] text-slate-400">{log.actorRole ?? 'SYSTEM'}</p>
                            </td>
                            <td>
                              <p className="text-xs text-slate-600">{log.entityType ?? '—'}</p>
                              <p className="max-w-[140px] truncate font-mono text-[10px] text-slate-400">{log.entityId ?? ''}</p>
                            </td>
                            <td>
                              <span className="font-mono text-[11px] text-slate-500">{log.ip ?? '—'}</span>
                            </td>
                            <td>
                              <span className="text-xs text-slate-500">{formatRelative(log.createdAt)}</span>
                            </td>
                            <td className="text-right">
                              <button
                                type="button"
                                onClick={() => setSelectedLog(log)}
                                className="text-xs font-semibold text-brand-700 hover:underline"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-slate-100 px-5 py-4">
                    <Pagination
                      page={auditQuery.data.meta.page}
                      totalPages={auditQuery.data.meta.totalPages}
                      total={auditQuery.data.meta.total}
                      onPageChange={setAuditPage}
                    />
                  </div>
                </>
              ) : (
                <EmptyState
                  title="No audit records found"
                  description="Try clearing the filters or perform an administrative action."
                  icon={Activity}
                />
              )}
            </Card>
          ) : null}
        </>
      )}

      <SidePanel
        open={selectedLog !== null}
        onClose={() => setSelectedLog(null)}
        title="Audit record"
        description={selectedLog ? `${selectedLog.action} · ${formatDateTime(selectedLog.createdAt)}` : undefined}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setSelectedLog(null)}>
            Close
          </Button>
        }
      >
        {selectedLog ? (
          <div className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ['Record ID', selectedLog.id],
                ['Action', selectedLog.action],
                ['Entity type', selectedLog.entityType ?? '—'],
                ['Entity ID', selectedLog.entityId ?? '—'],
                ['Actor', selectedLog.actor ? `${selectedLog.actor.name} (${selectedLog.actor.email})` : 'System'],
                ['Actor role', selectedLog.actorRole ?? 'SYSTEM'],
                ['IP address', selectedLog.ip ?? '—'],
                ['Request ID', selectedLog.requestId ?? '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className="mt-1 break-words text-sm text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Metadata</p>
              <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                {JSON.stringify(selectedLog.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
