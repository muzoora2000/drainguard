import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  CloudRain,
  Droplets,
  FlaskConical,
  Gauge,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  enumLabel,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
  formatShortDate,
  isOverdue,
} from '../lib/format';
import type {
  AlertSummary,
  AlertType,
  MaintenanceTask,
  Paginated,
  ReportOverview,
} from '../lib/types';
import {
  AlertTypeBadge,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  SeverityBadge,
  StatCard,
  TaskStatusBadge,
} from '../components/ui';
import { cn } from '../lib/format';

function buildSeries(dailyAlerts: Array<{ date: string; count: number }>) {
  const map = new Map(dailyAlerts.map((item) => [item.date, item.count]));
  const series: Array<{ date: string; count: number }> = [];
  const today = new Date();
  for (let index = 29; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    series.push({ date: key, count: map.get(key) ?? 0 });
  }
  return series;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-slate-500">{label ? formatShortDate(label) : ''}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">
        {formatNumber(payload[0]?.value)} alert{payload[0]?.value === 1 ? '' : 's'}
      </p>
    </div>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const role = session?.user.role;
  const canViewAlerts = role !== 'ENGINEER';

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api.get<{ data: ReportOverview }>('/api/reports/overview'),
  });

  const activeAlertsQuery = useQuery({
    queryKey: ['alerts', 'dashboard', 'active'],
    queryFn: () => api.get<Paginated<AlertSummary>>('/api/alerts', { status: 'ACTIVE', pageSize: 6 }),
    enabled: canViewAlerts,
  });

  const inProgressQuery = useQuery({
    queryKey: ['tasks', 'dashboard', 'in-progress'],
    queryFn: () => api.get<Paginated<MaintenanceTask>>('/api/tasks', { status: 'IN_PROGRESS', pageSize: 4 }),
  });

  const scheduledQuery = useQuery({
    queryKey: ['tasks', 'dashboard', 'scheduled'],
    queryFn: () =>
      api.get<Paginated<MaintenanceTask>>('/api/tasks', {
        status: 'SCHEDULED',
        pageSize: 4,
        ...(role === 'ENGINEER' ? { type: 'ENGINEERING_INVESTIGATION' } : {}),
      }),
  });

  const overview = overviewQuery.data?.data;
  const openTasks = useMemo(
    () =>
      [...(inProgressQuery.data?.data ?? []), ...(scheduledQuery.data?.data ?? [])]
        .filter((task, index, all) => all.findIndex((entry) => entry.id === task.id) === index)
        .sort((a, b) => {
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue;
        })
        .slice(0, 6),
    [inProgressQuery.data, scheduledQuery.data],
  );

  const series = useMemo(() => buildSeries(overview?.dailyAlerts ?? []), [overview?.dailyAlerts]);
  const maxTypeCount = Math.max(1, ...Object.values(overview?.alerts.byType ?? {}).map((value) => value ?? 0));
  const activeAlerts = overview?.alerts.byStatus.ACTIVE ?? 0;
  const healthyDevices = overview?.devices.byHealth.HEALTHY ?? 0;
  const deviceTotal = overview?.devices.total ?? 0;
  const deviceHealthPercent = deviceTotal > 0 ? (healthyDevices / deviceTotal) * 100 : 0;

  const refetchAll = () => {
    void overviewQuery.refetch();
    void activeAlertsQuery.refetch();
    void inProgressQuery.refetch();
    void scheduledQuery.refetch();
  };

  const alertTypeCounts = (Object.entries(overview?.alerts.byType ?? {}) as Array<[AlertType, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (overviewQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Operations overview" description="Loading the latest network status." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
        <Card padded={false}>
          <LoadingState rows={5} />
        </Card>
      </div>
    );
  }

  if (overviewQuery.isError || !overview) {
    return (
      <div className="space-y-6">
        <PageHeader title="Operations overview" description="Live status across the drainage network." />
        <Card>
          <ErrorState message={errorMessage(overviewQuery.error)} onRetry={() => void overviewQuery.refetch()} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        description="A 30-day view of alerts, maintenance and network condition. Use it to prioritise checks before asset condition worsens."
        eyebrow="Network status"
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refetchAll}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active alerts"
          value={formatNumber(activeAlerts)}
          hint={`${formatNumber(overview.alerts.total)} alerts in the last 30 days`}
          icon={AlertTriangle}
          tone={activeAlerts > 0 ? 'red' : 'brand'}
          onClick={canViewAlerts ? () => navigate('/alerts?status=ACTIVE') : undefined}
        />
        <StatCard
          label="Open maintenance"
          value={formatNumber(overview.tasks.open)}
          hint={`${formatNumber(overview.tasks.overdue)} overdue · ${formatPercent(overview.tasks.completionRate)} completion`}
          icon={ClipboardList}
          tone={overview.tasks.overdue > 0 ? 'amber' : 'blue'}
          onClick={() => navigate('/tasks')}
        />
        <StatCard
          label="Drains monitored"
          value={formatNumber(overview.drains.total)}
          hint={`${formatNumber(overview.drains.byStatus.ACTIVE ?? 0)} active across the network`}
          icon={Droplets}
          onClick={() => navigate('/drains')}
        />
        <StatCard
          label="Healthy devices"
          value={`${formatNumber(healthyDevices)}/${formatNumber(deviceTotal)}`}
          hint={`${formatNumber(overview.devices.byHealth.FAULTY ?? 0)} faulty · ${formatNumber(
            overview.devices.byHealth.OFFLINE ?? 0,
          )} offline`}
          icon={Gauge}
          tone={healthyDevices < deviceTotal ? 'amber' : 'brand'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Alert volume"
            description="Alerts raised per day across all drainage assets"
            action={
              <Badge tone="slate" dot>
                Last 30 days
              </Badge>
            }
          />
          <div className="mt-5 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="alertFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1f9f88" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1f9f88" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={26}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#157f6e"
                  strokeWidth={2}
                  fill="url(#alertFill)"
                  activeDot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Alert mix" description="What the rules detected in this period" />
          <div className="mt-5 space-y-4">
            {alertTypeCounts.length ? (
              alertTypeCounts.map(([type, count]) => (
                <div key={type}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700">{enumLabel(type)}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{formatNumber(count)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        type === 'HIGH_WATER'
                          ? 'bg-red-500'
                          : type === 'POSSIBLE_BLOCKAGE'
                            ? 'bg-amber-500'
                            : type === 'SYSTEM_HEALTH'
                              ? 'bg-blue-500'
                              : type === 'ENGINEERING_REVIEW'
                                ? 'bg-violet-500'
                                : 'bg-brand-500',
                      )}
                      style={{ width: `${Math.max(4, (count / maxTypeCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No alerts in this period" description="Rule checks are active but nothing triggered." icon={Activity} />
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Avg. acknowledge</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {formatDuration(overview.alerts.averageAcknowledgementMinutes)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Avg. resolution</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {formatDuration(overview.alerts.averageResolutionMinutes)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_0.9fr]">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {role === 'ENGINEER' ? 'Engineering reviews' : 'Active alerts'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {role === 'ENGINEER' ? 'Investigations that need engineering input' : 'Signals that need acknowledgement'}
              </p>
            </div>
            <Link to={role === 'ENGINEER' ? '/engineering' : '/alerts?status=ACTIVE'} className="surface-link text-xs">
              View all
            </Link>
          </div>
          {canViewAlerts ? (
            activeAlertsQuery.isLoading ? (
              <LoadingState rows={4} />
            ) : activeAlertsQuery.isError ? (
              <ErrorState message={errorMessage(activeAlertsQuery.error)} onRetry={() => void activeAlertsQuery.refetch()} />
            ) : activeAlertsQuery.data?.data.length ? (
              <div className="divide-y divide-slate-100">
                {activeAlertsQuery.data.data.map((alert) => (
                  <Link
                    key={alert.id}
                    to={`/alerts?alertId=${alert.id}`}
                    className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        alert.severity === 'CRITICAL'
                          ? 'bg-red-500'
                          : alert.severity === 'WARNING'
                            ? 'bg-amber-500'
                            : 'bg-blue-500',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTypeBadge type={alert.type} />
                        <span className="text-xs text-slate-400">{formatRelative(alert.createdAt)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-slate-800">{alert.drain?.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {alert.drain?.zone} · {alert.message ?? alert.rule}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="No active alerts" description="The network has no unacknowledged signals." icon={Activity} />
            )
          ) : scheduledQuery.isLoading ? (
            <LoadingState rows={4} />
          ) : scheduledQuery.data?.data.length ? (
            <div className="divide-y divide-slate-100">
              {scheduledQuery.data.data.map((task) => (
                <Link
                  key={task.id}
                  to="/engineering"
                  className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-slate-50"
                >
                  <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {task.drain.name} · {task.drain.zone}
                    </p>
                  </div>
                  <PriorityBadge priority={task.priority} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No engineering reviews" description="No investigation tasks are waiting." icon={FlaskConical} />
          )}
        </Card>

        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Open work</h2>
              <p className="mt-0.5 text-xs text-slate-500">Tasks in progress or scheduled next</p>
            </div>
            <Link to="/tasks" className="surface-link text-xs">
              View all
            </Link>
          </div>
          {inProgressQuery.isLoading || scheduledQuery.isLoading ? (
            <LoadingState rows={4} />
          ) : openTasks.length ? (
            <div className="divide-y divide-slate-100">
              {openTasks.map((task) => (
                <Link
                  key={task.id}
                  to={`/tasks?taskId=${task.id}`}
                  className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-slate-50"
                >
                  <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {task.drain.name} · {task.assignedTo?.name ?? 'Unassigned'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <TaskStatusBadge status={task.status} />
                      {isOverdue(task.dueAt, task.status) ? <Badge tone="red">Overdue</Badge> : null}
                      {task.dueAt ? (
                        <span className="text-[11px] text-slate-400">Due {formatRelative(task.dueAt)}</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No open tasks" description="All maintenance work is complete." icon={ClipboardList} />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Network health" description="Sensor availability" />
            <div className="mt-4">
              <div className="flex items-end justify-between">
                <p className="text-2xl font-semibold tracking-tight text-slate-900">
                  {formatNumber(deviceHealthPercent, 0)}%
                </p>
                <p className="text-xs text-slate-500">devices healthy</p>
              </div>
              <div className="mt-3">
                <ProgressBar value={deviceHealthPercent} tone={deviceHealthPercent >= 90 ? 'brand' : 'amber'} />
              </div>
              <div className="mt-4 space-y-2 text-sm">
                {(['HEALTHY', 'FAULTY', 'OFFLINE', 'UNKNOWN'] as const).map((health) => (
                  <div key={health} className="flex items-center justify-between">
                    <span className="text-slate-500">{enumLabel(health)}</span>
                    <span className="font-semibold tabular-nums text-slate-800">
                      {formatNumber(overview.devices.byHealth[health] ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <CloudRain className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Rainfall context</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatNumber(overview.rainfall.readings)} readings · avg{' '}
                  {formatNumber(overview.rainfall.averageMmPerHour, 1)} mm/h · max{' '}
                  {formatNumber(overview.rainfall.maxMmPerHour, 1)} mm/h
                </p>
                <p className="mt-2 text-[11px] leading-4 text-slate-400">
                  Intense rainfall is considered by the blockage rule to reduce misleading level-difference alerts.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Top problem drains</h2>
            <p className="mt-0.5 text-xs text-slate-500">Highest alert counts in the last 30 days</p>
          </div>
          <Link to="/drains" className="surface-link text-xs">
            Open map
          </Link>
        </div>
        {overview.topProblemDrains.length ? (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Drain</th>
                  <th>Zone</th>
                  <th>Alerts</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {overview.topProblemDrains.map((item, index) => (
                  <tr key={item.drain?.id ?? index}>
                    <td>
                      <span className="font-medium text-slate-900">{item.drain?.name ?? 'Unknown drain'}</span>
                    </td>
                    <td>{item.drain?.zone ?? '—'}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={item.alertCount >= 5 ? 'CRITICAL' : item.alertCount >= 2 ? 'WARNING' : 'INFO'} />
                        <span className="font-semibold text-slate-800">{formatNumber(item.alertCount)}</span>
                      </div>
                    </td>
                    <td className="text-right">
                      {item.drain ? (
                        <Link to={`/drains/${item.drain.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
                          Inspect <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No problem drains" description="No alerts were raised in this period." icon={Droplets} />
        )}
      </Card>
    </div>
  );
}
