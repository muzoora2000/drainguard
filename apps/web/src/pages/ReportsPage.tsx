import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudRain,
  Download,
  Droplets,
  Gauge,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
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
  formatDuration,
  formatNumber,
  formatPercent,
  formatShortDate,
} from '../lib/format';
import type {
  AlertType,
  DrainListItem,
  Paginated,
  ReportOverview,
  TaskStatus,
} from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  useToast,
} from '../components/ui';

const severityColors: Record<string, string> = {
  CRITICAL: '#dc2626',
  WARNING: '#f59e0b',
  INFO: '#3b82f6',
};

const taskColors: Record<string, string> = {
  SCHEDULED: '#3b82f6',
  IN_PROGRESS: '#f59e0b',
  DONE: '#10b981',
  CANCELLED: '#94a3b8',
};

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  if (!from || !to) return [];
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return [];
  while (cursor <= end && days.length < 120) {
    days.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function ReportsTooltip({
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

export function ReportsPage() {
  const { session } = useAuth();
  const { toast } = useToast();
  const canExport = session?.user.role === 'ADMIN' || session?.user.role === 'SUPERVISOR';
  const today = new Date();
  const initialFrom = new Date(today.getTime() - 29 * 86_400_000);

  const [fromDate, setFromDate] = useState(dateKey(initialFrom));
  const [toDate, setToDate] = useState(dateKey(today));
  const [preset, setPreset] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [zone, setZone] = useState('');
  const [downloading, setDownloading] = useState<'alerts' | 'tasks' | null>(null);

  const setRange = (days: 7 | 30 | 90) => {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    setPreset(String(days) as '7' | '30' | '90');
    setFromDate(dateKey(start));
    setToDate(dateKey(end));
  };

  const fromIso = `${fromDate}T00:00:00`;
  const toIso = `${toDate}T23:59:59.999`;
  const invalidRange = !fromDate || !toDate || new Date(fromIso) > new Date(toIso);

  const overviewQuery = useQuery({
    queryKey: ['reports', 'overview', fromIso, toIso, zone],
    queryFn: () =>
      api.get<{ data: ReportOverview }>('/api/reports/overview', {
        from: new Date(fromIso).toISOString(),
        to: new Date(toIso).toISOString(),
        zone: zone || undefined,
      }),
    enabled: !invalidRange,
  });

  const zonesQuery = useQuery({
    queryKey: ['drains', 'zones'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 100 }),
    staleTime: 120_000,
  });

  const overview = overviewQuery.data?.data;
  const zones = [...new Set((zonesQuery.data?.data ?? []).map((drain) => drain.zone))].sort();

  const series = useMemo(() => {
    const days = daysBetween(fromDate, toDate);
    const counts = new Map((overview?.dailyAlerts ?? []).map((item) => [item.date, item.count]));
    return days.map((date) => ({ date, count: counts.get(date) ?? 0 }));
  }, [fromDate, toDate, overview?.dailyAlerts]);

  const severityData = (Object.entries(overview?.alerts.bySeverity ?? {}) as Array<[string, number]>)
    .filter(([, count]) => count > 0)
    .map(([name, value]) => ({ name, value }));

  const tasksByStatus = (Object.entries(overview?.tasks.byStatus ?? {}) as Array<[TaskStatus, number]>)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));

  const alertTypes = (Object.entries(overview?.alerts.byType ?? {}) as Array<[AlertType, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxAlertType = Math.max(1, ...alertTypes.map(([, count]) => count));

  const downloadCsv = async (kind: 'alerts' | 'tasks') => {
    setDownloading(kind);
    try {
      const blob = await api.download(`/api/reports/${kind}.csv`, {
        from: new Date(fromIso).toISOString(),
        to: new Date(toIso).toISOString(),
        zone: zone || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `drainguard-${kind}-${fromDate}-to-${toDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast(`${kind === 'alerts' ? 'Alert' : 'Task'} export downloaded.`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Review alert, maintenance and rainfall performance over a selected period. Export the underlying records for operational reporting."
        eyebrow="Operational insight"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void overviewQuery.refetch()}>
              Refresh
            </Button>
            {canExport ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  loading={downloading === 'alerts'}
                  onClick={() => void downloadCsv('alerts')}
                  disabled={invalidRange || downloading !== null}
                >
                  Alerts CSV
                </Button>
                <Button
                  size="sm"
                  icon={Download}
                  loading={downloading === 'tasks'}
                  onClick={() => void downloadCsv('tasks')}
                  disabled={invalidRange || downloading !== null}
                >
                  Tasks CSV
                </Button>
              </>
            ) : (
              <Badge tone="slate">Exports require supervisor access</Badge>
            )}
          </>
        }
      />

      <Card>
        <div className="grid gap-4 lg:grid-cols-[auto_1fr_1fr_1.1fr]">
          <div>
            <p className="field-label">Period</p>
            <div className="flex rounded-xl bg-slate-100 p-1">
              {(['7', '30', '90'] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setRange(Number(days) as 7 | 30 | 90)}
                  className={cn(
                    'rounded-lg px-3 py-2 text-xs font-semibold transition',
                    preset === days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {days}d
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset('custom')}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs font-semibold transition',
                  preset === 'custom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                Custom
              </button>
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="report-from">
              From
            </label>
            <input
              id="report-from"
              type="date"
              className="field-input"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => {
                setFromDate(event.target.value);
                setPreset('custom');
              }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="report-to">
              To
            </label>
            <input
              id="report-to"
              type="date"
              className="field-input"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => {
                setToDate(event.target.value);
                setPreset('custom');
              }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="report-zone">
              Zone
            </label>
            <select
              id="report-zone"
              className="field-select"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
            >
              <option value="">All zones</option>
              {zones.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>
        {invalidRange ? (
          <p className="mt-3 text-sm font-medium text-red-600">The start date must be before the end date.</p>
        ) : null}
      </Card>

      {overviewQuery.isLoading ? (
        <Card padded={false}>
          <LoadingState rows={7} />
        </Card>
      ) : overviewQuery.isError || !overview ? (
        <Card>
          <ErrorState
            message={invalidRange ? 'Choose a valid reporting period.' : errorMessage(overviewQuery.error)}
            onRetry={invalidRange ? undefined : () => void overviewQuery.refetch()}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Alerts raised</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{formatNumber(overview.alerts.total)}</p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-50 text-red-600">
                  <AlertTriangle className="h-[18px] w-[18px]" />
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="red">{formatNumber(overview.alerts.byStatus.ACTIVE ?? 0)} active</Badge>
                <Badge tone="green">{formatNumber(overview.alerts.byStatus.RESOLVED ?? 0)} resolved</Badge>
              </div>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Task completion</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                    {formatPercent(overview.tasks.completionRate ?? null, 1)}
                  </p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {formatNumber(overview.tasks.total)} tasks · {formatNumber(overview.tasks.overdue)} overdue
              </p>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Average acknowledgement</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                    {formatDuration(overview.alerts.averageAcknowledgementMinutes)}
                  </p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
                  <Clock className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Resolution average {formatDuration(overview.alerts.averageResolutionMinutes)}
              </p>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Peak rainfall</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                    {formatNumber(overview.rainfall.maxMmPerHour, 1)}
                    <span className="ml-1 text-sm font-medium text-slate-400">mm/h</span>
                  </p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-50 text-cyan-600">
                  <CloudRain className="h-[18px] w-[18px]" />
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {formatNumber(overview.rainfall.readings)} readings · avg {formatNumber(overview.rainfall.averageMmPerHour, 1)} mm/h
              </p>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Card>
              <CardHeader
                title="Alert volume"
                description={`${formatShortDate(fromDate)} to ${formatShortDate(toDate)}${zone ? ` · ${zone}` : ''}`}
              />
              <div className="mt-5 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="reportAlertFill" x1="0" y1="0" x2="0" y2="1">
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
                      minTickGap={28}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={42} />
                    <Tooltip content={<ReportsTooltip />} />
                    <Area type="monotone" dataKey="count" stroke="#157f6e" strokeWidth={2} fill="url(#reportAlertFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title="Alert severity" description="Distribution for the selected period" />
              <div className="mt-2 grid grid-cols-[1fr_1.1fr] items-center gap-4">
                <div className="h-48">
                  {severityData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={severityData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={72}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {severityData.map((entry) => (
                            <Cell key={entry.name} fill={severityColors[entry.name] ?? '#94a3b8'} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-slate-400">No alerts</div>
                  )}
                </div>
                <div className="space-y-3">
                  {(['CRITICAL', 'WARNING', 'INFO'] as const).map((severity) => (
                    <div key={severity} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: severityColors[severity] }} />
                        {enumLabel(severity)}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {formatNumber(overview.alerts.bySeverity[severity] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tasks by status</p>
                <div className="mt-3 h-28">
                  {tasksByStatus.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tasksByStatus} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                        <XAxis
                          dataKey="status"
                          tickFormatter={(value: string) => enumLabel(value).replace(' ', '\u00a0')}
                          tick={{ fontSize: 9, fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} />
                        <Tooltip
                          formatter={(value) => [formatNumber(Number(value)), 'Tasks']}
                          labelFormatter={(value) => enumLabel(String(value))}
                        />
                        <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                          {tasksByStatus.map((entry) => (
                            <Cell key={entry.status} fill={taskColors[entry.status] ?? '#94a3b8'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-slate-400">No tasks</div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
            <Card>
              <CardHeader title="Alert mix" description="Detection types in this period" />
              <div className="mt-5 space-y-4">
                {alertTypes.length ? (
                  alertTypes.map(([type, count]) => (
                    <div key={type}>
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-700">{enumLabel(type)}</span>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">{formatNumber(count)}</span>
                      </div>
                      <ProgressBar value={(count / maxAlertType) * 100} tone={type === 'HIGH_WATER' ? 'red' : type === 'POSSIBLE_BLOCKAGE' ? 'amber' : 'blue'} />
                    </div>
                  ))
                ) : (
                  <EmptyState title="No alerts" description="No alert was raised in the selected period." icon={Gauge} />
                )}
              </div>
            </Card>

            <Card padded={false}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Top problem drains</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Highest alert volume in this period</p>
                </div>
                <Link to="/drains" className="surface-link text-xs">
                  Network register
                </Link>
              </div>
              {overview.topProblemDrains.length ? (
                <div className="table-shell">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Drain</th>
                        <th>Zone</th>
                        <th>Alert count</th>
                        <th className="text-right">Open</th>
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
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-brand-500"
                                  style={{
                                    width: `${(item.alertCount / Math.max(1, overview.topProblemDrains[0].alertCount)) * 100}%`,
                                  }}
                                />
                              </div>
                              <span className="text-xs font-semibold text-slate-700">{formatNumber(item.alertCount)}</span>
                            </div>
                          </td>
                          <td className="text-right">
                            {item.drain ? (
                              <Link to={`/drains/${item.drain.id}`} className="text-xs font-semibold text-brand-700 hover:underline">
                                Inspect
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
              ) : (
                <EmptyState title="No problem drains" description="No alerts were raised in this period." icon={Droplets} />
              )}
            </Card>
          </div>

          <Card>
            <div className="grid gap-5 sm:grid-cols-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">
                  <Wrench className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Maintenance coverage</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {formatNumber(overview.tasks.open)} open tasks and {formatNumber(overview.tasks.overdue)} overdue. Completion rate is based on all tasks created in the period.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">
                  <Droplets className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Device context</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {formatNumber(overview.devices.byHealth.HEALTHY ?? 0)} healthy,{' '}
                    {formatNumber(overview.devices.byHealth.FAULTY ?? 0)} faulty and{' '}
                    {formatNumber(overview.devices.byHealth.OFFLINE ?? 0)} offline devices support this reporting period.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Export integrity</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    CSV exports contain the underlying records. Spreadsheet formula prefixes are neutralised by the API.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
