import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Battery,
  Clock,
  CloudRain,
  Droplets,
  Gauge,
  MapPin,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  cn,
  enumLabel,
  formatDateTime,
  formatNumber,
  formatRelative,
  formatTime,
  isOverdue,
  isRecent,
} from '../lib/format';
import type {
  DrainDetail,
  DrainListItem,
  LiveDrain,
  Paginated,
  SensorReading,
} from '../lib/types';
import { DrainMap } from '../components/DrainMap';
import {
  AlertStatusBadge,
  Badge,
  Button,
  Card,
  CardHeader,
  DeviceHealthBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  SeverityBadge,
  TaskStatusBadge,
} from '../components/ui';

type WindowSize = 1 | 7;

function ReadingTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-slate-500">{label ? formatDateTime(label) : ''}</p>
      {payload.map((item) => (
        <p key={item.name} className="mt-1 flex items-center gap-1.5 font-semibold text-slate-800">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.name}: {formatNumber(item.value, 1)}
        </p>
      ))}
    </div>
  );
}

function WaterChart({ readings }: { readings: SensorReading[] }) {
  const data = useMemo(() => {
    const points = new Map<string, { time: string; upstream?: number; downstream?: number }>();
    for (const reading of readings) {
      if (reading.type === 'LITTER' || reading.value === null) continue;
      const point = points.get(reading.recordedAt) ?? { time: reading.recordedAt };
      if (reading.type === 'WATER_UPSTREAM') point.upstream = reading.value;
      if (reading.type === 'WATER_DOWNSTREAM') point.downstream = reading.value;
      points.set(reading.recordedAt, point);
    }
    return [...points.values()].sort((a, b) => a.time.localeCompare(b.time));
  }, [readings]);

  if (data.length === 0) {
    return <div className="grid h-52 place-items-center text-sm text-slate-400">No water readings in this window.</div>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="time"
            tickFormatter={(value: string) => formatTime(value)}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            minTickGap={35}
          />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={42} unit="cm" />
          <Tooltip content={<ReadingTooltip />} />
          <Line type="monotone" dataKey="upstream" name="Upstream" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="downstream" name="Downstream" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function LitterChart({ readings }: { readings: SensorReading[] }) {
  const data = useMemo(
    () =>
      readings
        .filter((reading) => reading.type === 'LITTER' && reading.value !== null)
        .map((reading) => ({ time: reading.recordedAt, fill: reading.value }))
        .sort((a, b) => a.time.localeCompare(b.time)),
    [readings],
  );

  if (data.length === 0) {
    return <div className="grid h-52 place-items-center text-sm text-slate-400">No litter readings in this window.</div>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="time"
            tickFormatter={(value: string) => formatTime(value)}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            minTickGap={35}
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={42} unit="%" />
          <Tooltip content={<ReadingTooltip />} />
          <Line type="monotone" dataKey="fill" name="Basket fill" stroke="#1f9f88" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrainDetailPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const role = session?.user.role ?? 'TECHNICIAN';
  const canViewAlerts = role !== 'ENGINEER';
  const canReadHistory = role !== 'ENGINEER';
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const [windowDays, setWindowDays] = useState<WindowSize>(1);

  const drainQuery = useQuery({
    queryKey: ['drain', id, 'detail'],
    queryFn: () => api.get<{ data: DrainDetail }>(`/api/drains/${id}`),
    enabled: Boolean(id),
  });

  const liveQuery = useQuery({
    queryKey: ['drain', id, 'live'],
    queryFn: () => api.get<{ data: LiveDrain }>(`/api/drains/${id}/live`),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  });

  const readingsQuery = useQuery({
    queryKey: ['readings', id, windowDays],
    queryFn: () => {
      const from = new Date(Date.now() - windowDays * 86_400_000).toISOString();
      return api.get<Paginated<SensorReading>>('/api/readings', {
        drainId: id,
        from,
        pageSize: 100,
      });
    },
    enabled: Boolean(id) && canReadHistory,
  });

  const drain = drainQuery.data?.data;
  const live = liveQuery.data?.data;
  const readings = readingsQuery.data?.data ?? [];

  const openAlerts = useMemo(
    () => (drain?.alerts ?? []).filter((alert) => alert.status !== 'RESOLVED'),
    [drain?.alerts],
  );
  const criticalAlert = openAlerts.find((alert) => alert.severity === 'CRITICAL' && alert.status === 'ACTIVE');
  const latestByType = useMemo(() => {
    const map = new Map<string, SensorReading | null>();
    for (const item of live?.devices ?? []) {
      map.set(item.device.type, item.reading);
    }
    return map;
  }, [live?.devices]);

  const upstream = latestByType.get('WATER_UPSTREAM');
  const downstream = latestByType.get('WATER_DOWNSTREAM');
  const litter = latestByType.get('LITTER');
  const difference =
    upstream?.waterLevelCm !== null &&
    upstream?.waterLevelCm !== undefined &&
    downstream?.waterLevelCm !== null &&
    downstream?.waterLevelCm !== undefined
      ? upstream.waterLevelCm - downstream.waterLevelCm
      : null;

  const mapDrain: DrainListItem | null = drain
    ? {
        ...drain,
        devices: drain.devices,
        alerts: drain.alerts,
        _count: { alerts: drain.alerts.length, tasks: drain.tasks.length },
      }
    : null;

  const refresh = () => {
    void drainQuery.refetch();
    void liveQuery.refetch();
    void readingsQuery.refetch();
  };

  if (drainQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-20 animate-pulse rounded-2xl bg-white" />
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-36 animate-pulse rounded-2xl bg-white" />
          ))}
        </div>
        <Card padded={false}>
          <LoadingState rows={5} />
        </Card>
      </div>
    );
  }

  if (drainQuery.isError || !drain) {
    return (
      <div className="space-y-6">
        <PageHeader title="Drain detail" />
        <Card>
          <ErrorState
            title="Drain not available"
            message={errorMessage(drainQuery.error)}
            onRetry={() => void drainQuery.refetch()}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={drain.name}
        description={`${drain.zone}${drain.address ? ` · ${drain.address}` : ''}. Review live sensor status, rule thresholds and the maintenance trail.`}
        eyebrow="Drain detail"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>
              Refresh
            </Button>
            {canManage ? (
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={() => navigate(`/tasks?create=1&drainId=${drain.id}`)}
              >
                Raise task
              </Button>
            ) : null}
            {role === 'ADMIN' ? (
              <Button
                size="sm"
                icon={Pencil}
                onClick={() => navigate(`/admin?tab=drains&drainId=${drain.id}`)}
              >
                Edit drain
              </Button>
            ) : null}
          </>
        }
      />

      {criticalAlert ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {enumLabel(criticalAlert.type)} needs attention at {formatRelative(criticalAlert.createdAt)}
            </p>
            <p className="mt-0.5 text-red-700">{criticalAlert.message ?? criticalAlert.rule}</p>
          </div>
          {canViewAlerts ? (
            <Link
              to={`/alerts?alertId=${criticalAlert.id}`}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              Review alert
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Basket fill</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                {litter?.value !== null && litter?.value !== undefined ? `${formatNumber(litter.value, 0)}%` : '—'}
              </p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Droplets className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-4">
            <ProgressBar
              value={litter?.value ?? null}
              tone={(litter?.value ?? 0) >= (drain.thresholds?.basketFillPercent ?? 85) ? 'red' : 'brand'}
              label={`Alert threshold ${formatNumber(drain.thresholds?.basketFillPercent ?? 85)}%`}
            />
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            {litter ? formatRelative(litter.recordedAt) : 'No reading received'}
          </p>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Water level difference</p>
              <p className={cn('mt-2 text-3xl font-semibold tracking-tight', (difference ?? 0) >= (drain.thresholds?.levelDifferenceCm ?? 15) ? 'text-amber-600' : 'text-slate-900')}>
                {difference === null ? '—' : `${formatNumber(difference, 1)} cm`}
              </p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <Gauge className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Upstream</p>
              <p className="mt-1 font-semibold text-slate-900">
                {upstream?.value !== null && upstream?.value !== undefined ? `${formatNumber(upstream.value, 1)} cm` : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Downstream</p>
              <p className="mt-1 font-semibold text-slate-900">
                {downstream?.value !== null && downstream?.value !== undefined ? `${formatNumber(downstream.value, 1)} cm` : '—'}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Alert threshold {formatNumber(drain.thresholds?.levelDifferenceCm ?? 15, 0)} cm sustained for{' '}
            {formatNumber(drain.thresholds?.differencePersistMinutes ?? 15)} min
          </p>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Rainfall context</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                {live?.rainfall ? `${formatNumber(live.rainfall.mmPerHour, 1)}` : '—'}
                <span className="ml-1 text-sm font-medium text-slate-400">mm/h</span>
              </p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
              <CloudRain className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {live?.rainfall
              ? `${live.rainfall.source === 'MANUAL' ? 'Manual reading' : live.rainfall.source === 'SENSOR' ? 'Sensor reading' : 'Weather API reading'} at ${formatDateTime(live.rainfall.recordedAt)}`
              : 'No rainfall reading for this zone.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="slate">
              Intense rain ≥ {formatNumber(drain.thresholds?.intenseRainfallMmPerHour ?? 20, 0)} mm/h
            </Badge>
            <Badge tone="slate">Lookback {formatNumber(drain.thresholds?.rainfallLookbackMinutes ?? 30)} min</Badge>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader
            title="Sensor history"
            description="Latest readings returned by the API. Readings are checked by the rules engine on ingestion."
            action={
              <div className="flex rounded-lg bg-slate-100 p-1">
                {[1, 7].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setWindowDays(value as WindowSize)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition',
                      windowDays === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                    )}
                  >
                    {value === 1 ? '24 hours' : '7 days'}
                  </button>
                ))}
              </div>
            }
          />
          {!canReadHistory ? (
            <EmptyState
              title="Historical readings are not available to engineering accounts"
              description="Latest values and alert evidence remain visible on this page."
              icon={Gauge}
            />
          ) : readingsQuery.isLoading ? (
            <LoadingState rows={3} />
          ) : readingsQuery.isError ? (
            <ErrorState message={errorMessage(readingsQuery.error)} onRetry={() => void readingsQuery.refetch()} />
          ) : (
            <div className="mt-4 grid gap-5">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Water levels</h3>
                  <div className="flex gap-3 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-blue-600" /> Upstream
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" /> Downstream
                    </span>
                  </div>
                </div>
                <WaterChart readings={readings} />
              </div>
              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Basket fill</h3>
                <LitterChart readings={readings} />
              </div>
              <p className="text-[11px] text-slate-400">
                Showing up to 100 readings from the last {windowDays === 1 ? '24 hours' : '7 days'}. Chart interval reflects actual reporting frequency.
              </p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Assets and sensors</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {drain.devices.length} device{drain.devices.length === 1 ? '' : 's'} installed
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {drain.devices.length ? (
                drain.devices.map((device) => {
                  const latest = live?.devices.find((item) => item.device.id === device.id)?.reading;
                  return (
                    <div key={device.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{device.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {enumLabel(device.type)} · {device.serialNumber}
                          </p>
                        </div>
                        <DeviceHealthBadge health={device.healthStatus} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                          <p className="flex items-center gap-1 text-slate-400">
                            <Battery className="h-3 w-3" /> Battery
                          </p>
                          <p className="mt-1 font-semibold text-slate-800">
                            {device.batteryPercent === null ? '—' : `${formatNumber(device.batteryPercent, 0)}%`}
                          </p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                          <p className="flex items-center gap-1 text-slate-400">
                            <Radio className="h-3 w-3" /> Last seen
                          </p>
                          <p className={cn('mt-1 font-semibold', isRecent(device.lastSeenAt, 15) ? 'text-emerald-700' : 'text-slate-800')}>
                            {device.lastSeenAt ? formatRelative(device.lastSeenAt) : 'Never'}
                          </p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                          <p className="text-slate-400">Latest</p>
                          <p className="mt-1 font-semibold text-slate-800">
                            {latest?.value !== null && latest?.value !== undefined
                              ? device.type === 'LITTER'
                                ? `${formatNumber(latest.value, 0)}%`
                                : `${formatNumber(latest.value, 1)} cm`
                              : '—'}
                          </p>
                        </div>
                      </div>
                      {device.healthReason ? (
                        <p className="mt-2 text-xs text-amber-700">Health note: {device.healthReason}</p>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <EmptyState title="No devices installed" description="Add sensors before readings can be ingested." icon={Radio} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Live location" description={`${drain.latitude.toFixed(5)}, ${drain.longitude.toFixed(5)}`} />
            {mapDrain ? <DrainMap drains={[mapDrain]} className="mt-4 h-52" singleDrain /> : null}
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <MapPin className="h-3.5 w-3.5" />
              {drain.address ?? 'No street address recorded'}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Alert history</h2>
              <p className="mt-0.5 text-xs text-slate-500">Most recent 20 signals for this drain</p>
            </div>
            {canViewAlerts ? (
              <Link to={`/alerts?drainId=${drain.id}`} className="surface-link text-xs">
                View queue
              </Link>
            ) : null}
          </div>
          {drain.alerts.length ? (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {drain.alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>
                        {canViewAlerts ? (
                          <Link to={`/alerts?alertId=${alert.id}`} className="font-medium text-slate-800 hover:text-brand-700">
                            {enumLabel(alert.type)}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-800">{enumLabel(alert.type)}</span>
                        )}
                        <p className="mt-0.5 max-w-[280px] truncate text-xs text-slate-400">
                          {alert.message ?? alert.rule}
                        </p>
                      </td>
                      <td>
                        <SeverityBadge severity={alert.severity} />
                      </td>
                      <td>
                        <AlertStatusBadge status={alert.status} />
                      </td>
                      <td>
                        <span className="text-xs text-slate-500">{formatRelative(alert.createdAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No alerts recorded" description="No rule has raised an alert for this drain." icon={ShieldCheck} />
          )}
        </Card>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Open maintenance</h2>
                <p className="mt-0.5 text-xs text-slate-500">Scheduled and in-progress work</p>
              </div>
              <Link to={`/tasks?drainId=${drain.id}`} className="surface-link text-xs">
                All tasks
              </Link>
            </div>
            {drain.tasks.length ? (
              <div className="divide-y divide-slate-100">
                {drain.tasks.map((task) => (
                  <Link
                    key={task.id}
                    to={`/tasks?taskId=${task.id}`}
                    className="block px-5 py-3.5 transition hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {task.assignedTo?.name ?? 'Unassigned'}
                          {task.dueAt ? ` · due ${formatRelative(task.dueAt)}` : ''}
                        </p>
                      </div>
                      <PriorityBadge priority={task.priority} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <TaskStatusBadge status={task.status} />
                      {isOverdue(task.dueAt, task.status) ? <Badge tone="red">Overdue</Badge> : null}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="No open work" description="No maintenance task is scheduled." icon={Wrench} />
            )}
          </Card>

          <Card>
            <CardHeader title="Rule thresholds" description="Configured per drain" />
            <dl className="mt-4 space-y-2.5 text-sm">
              {[
                ['Basket fill', `${formatNumber(drain.thresholds?.basketFillPercent ?? 85, 0)}%`],
                ['Water rise rate', `${formatNumber(drain.thresholds?.waterRiseRateCmPerMin ?? 2, 1)} cm/min`],
                ['Level difference', `${formatNumber(drain.thresholds?.levelDifferenceCm ?? 15, 0)} cm`],
                ['Difference persists', `${formatNumber(drain.thresholds?.differencePersistMinutes ?? 15)} min`],
                ['Heartbeat timeout', `${formatNumber(drain.thresholds?.heartbeatTimeoutMinutes ?? 10)} min`],
                ['Repeat blockages', `${formatNumber(drain.thresholds?.repeatBlockageCount ?? 3)} in ${formatNumber(drain.thresholds?.repeatBlockageWindowDays ?? 30)} days`],
                ['Alert cooldown', `${formatNumber(drain.thresholds?.alertCooldownMinutes ?? 30)} min`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      {drain.assignments.length ? (
        <Card>
          <CardHeader title="Assigned responders" description="Technicians and supervisors linked to this drain" />
          <div className="mt-4 flex flex-wrap gap-2">
            {drain.assignments.map((assignment) => (
              <Badge key={assignment.id} tone="slate">
                {assignment.user.name} · {enumLabel(assignment.user.role)}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
