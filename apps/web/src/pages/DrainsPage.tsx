import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Droplets,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce } from '../hooks/useDebounce';
import {
  cn,
  enumLabel,
  formatNumber,
  formatRelative,
  isRecent,
} from '../lib/format';
import type { DrainListItem, DrainStatus, Paginated } from '../lib/types';
import { DrainMap } from '../components/DrainMap';
import {
  Badge,
  Button,
  Card,
  DrainStatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
} from '../components/ui';

function healthSummary(drain: DrainListItem) {
  const healthy = drain.devices.filter((device) => device.healthStatus === 'HEALTHY').length;
  const faulty = drain.devices.filter((device) => device.healthStatus === 'FAULTY').length;
  const offline = drain.devices.filter((device) => device.healthStatus === 'OFFLINE').length;
  return { healthy, faulty, offline };
}

export function DrainsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');
  const [status, setStatus] = useState<'' | DrainStatus>('');
  const debouncedSearch = useDebounce(search);

  const drainsQuery = useQuery({
    queryKey: ['drains', 'list', debouncedSearch, zone, status],
    queryFn: () =>
      api.get<Paginated<DrainListItem>>('/api/drains', {
        pageSize: 100,
        q: debouncedSearch || undefined,
        zone: zone || undefined,
        status: status || undefined,
      }),
  });

  const zonesQuery = useQuery({
    queryKey: ['drains', 'zones'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 100 }),
    staleTime: 120_000,
  });

  const drains = drainsQuery.data?.data ?? [];
  const zones = useMemo(
    () => [...new Set((zonesQuery.data?.data ?? []).map((drain) => drain.zone))].sort(),
    [zonesQuery.data],
  );

  const summary = useMemo(() => {
    const active = drains.filter((drain) => drain.status === 'ACTIVE').length;
    const openAlerts = drains.reduce((total, drain) => total + drain.alerts.length, 0);
    const offlineDevices = drains.reduce(
      (total, drain) => total + drain.devices.filter((device) => device.healthStatus === 'OFFLINE').length,
      0,
    );
    return { active, openAlerts, offlineDevices };
  }, [drains]);

  const attention = useMemo(
    () =>
      [...drains]
        .sort((a, b) => {
          const severity = (drain: DrainListItem) => {
            const severities = drain.alerts.map((alert) => alert.severity);
            if (severities.includes('CRITICAL')) return 3;
            if (severities.includes('WARNING')) return 2;
            if (severities.includes('INFO')) return 1;
            return 0;
          };
          return severity(b) - severity(a) || b.alerts.length - a.alerts.length;
        })
        .slice(0, 6),
    [drains],
  );

  const showClear = Boolean(search || zone || status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drains & map"
        description="Locate drainage assets, inspect sensor health and open a drain to review live readings, alert history and work."
        eyebrow="Network assets"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void drainsQuery.refetch()}>
              Refresh
            </Button>
            {session?.user.role === 'ADMIN' ? (
              <Button size="sm" icon={Plus} onClick={() => navigate('/admin?tab=drains')}>
                Add drain
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-card">
          <p className="text-xs font-medium text-slate-500">Drains shown</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(drains.length)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-card">
          <p className="text-xs font-medium text-slate-500">Active assets</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(summary.active)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-card">
          <p className="text-xs font-medium text-slate-500">Open alerts</p>
          <p className={cn('mt-1 text-2xl font-semibold', summary.openAlerts ? 'text-red-600' : 'text-slate-900')}>
            {formatNumber(summary.openAlerts)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-card">
          <p className="text-xs font-medium text-slate-500">Offline devices</p>
          <p className={cn('mt-1 text-2xl font-semibold', summary.offlineDevices ? 'text-amber-600' : 'text-slate-900')}>
            {formatNumber(summary.offlineDevices)}
          </p>
        </div>
      </div>

      <Card className="p-3 sm:p-4" padded={false}>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="field-input pl-10"
              placeholder="Search name, address or zone"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search drains"
            />
          </div>
          <select
            className="field-select min-w-[160px]"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            aria-label="Filter by zone"
          >
            <option value="">All zones</option>
            {zones.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className="field-select min-w-[150px]"
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | DrainStatus)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          {showClear ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('');
                setZone('');
                setStatus('');
              }}
            >
              Clear
            </Button>
          ) : (
            <span className="hidden items-center gap-1.5 px-2 text-xs text-slate-400 lg:flex">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </span>
          )}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <div className="relative">
          {drainsQuery.isLoading ? (
            <div className="h-[480px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ) : drainsQuery.isError ? (
            <Card>
              <ErrorState message={errorMessage(drainsQuery.error)} onRetry={() => void drainsQuery.refetch()} />
            </Card>
          ) : (
            <DrainMap drains={drains} className="h-[480px]" />
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-sm backdrop-blur">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500 shadow" /> Critical
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500 shadow" /> Warning
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 shadow" /> Clear
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400 shadow" /> Inactive
            </span>
          </div>
        </div>

        <Card padded={false}>
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                Needs attention
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">Ranked by current alert severity</p>
            </div>
          </div>
          {drainsQuery.isLoading ? (
            <LoadingState rows={5} />
          ) : attention.length ? (
            <div className="divide-y divide-slate-100">
              {attention.map((drain) => {
                const health = healthSummary(drain);
                return (
                  <Link
                    key={drain.id}
                    to={`/drains/${drain.id}`}
                    className="block px-5 py-3.5 transition hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{drain.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {drain.zone}
                          {drain.address ? ` · ${drain.address}` : ''}
                        </p>
                      </div>
                      <DrainStatusBadge status={drain.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {drain.alerts.length ? (
                        <Badge tone={drain.alerts.some((alert) => alert.severity === 'CRITICAL') ? 'red' : 'amber'}>
                          {drain.alerts.length} alert{drain.alerts.length === 1 ? '' : 's'}
                        </Badge>
                      ) : (
                        <Badge tone="green">Clear</Badge>
                      )}
                      {health.faulty > 0 ? <Badge tone="red">{health.faulty} faulty</Badge> : null}
                      {health.offline > 0 ? <Badge tone="amber">{health.offline} offline</Badge> : null}
                      <span className="text-[11px] text-slate-400">
                        {drain.devices.length} device{drain.devices.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No drains to prioritise" description="Adjust the filters or add a drain." icon={Droplets} />
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Network register</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatNumber(drainsQuery.data?.meta.total ?? 0)} matching drainage assets
            </p>
          </div>
          <Badge tone="slate" dot>
            Map and register share the same filters
          </Badge>
        </div>

        {drainsQuery.isLoading ? (
          <LoadingState rows={6} />
        ) : drainsQuery.isError ? (
          <ErrorState message={errorMessage(drainsQuery.error)} onRetry={() => void drainsQuery.refetch()} />
        ) : drains.length === 0 ? (
          <EmptyState
            title="No drains match"
            description="Try clearing the search or filter selections."
            icon={MapIcon}
            action={
              showClear ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setZone('');
                    setStatus('');
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Drain</th>
                  <th>Zone</th>
                  <th>Status</th>
                  <th>Sensors</th>
                  <th>Open alerts</th>
                  <th>Work</th>
                  <th>Last seen</th>
                  <th className="text-right">Inspect</th>
                </tr>
              </thead>
              <tbody>
                {drains.map((drain) => {
                  const health = healthSummary(drain);
                  const lastSeen = drain.devices
                    .map((device) => device.lastSeenAt)
                    .filter((value): value is string => Boolean(value))
                    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
                  return (
                    <tr key={drain.id} className="cursor-pointer" onClick={() => navigate(`/drains/${drain.id}`)}>
                      <td>
                        <Link to={`/drains/${drain.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {drain.name}
                        </Link>
                        <p className="mt-0.5 max-w-[260px] truncate text-xs text-slate-400">{drain.address ?? 'No address'}</p>
                      </td>
                      <td>{drain.zone}</td>
                      <td>
                        <DrainStatusBadge status={drain.status} />
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {drain.devices.length ? (
                            drain.devices.slice(0, 3).map((device) => (
                              <span
                                key={device.id}
                                title={`${enumLabel(device.type)}: ${enumLabel(device.healthStatus)}`}
                                className={cn(
                                  'h-2.5 w-2.5 rounded-full',
                                  device.healthStatus === 'HEALTHY'
                                    ? 'bg-emerald-500'
                                    : device.healthStatus === 'FAULTY'
                                      ? 'bg-red-500'
                                      : device.healthStatus === 'OFFLINE'
                                        ? 'bg-amber-500'
                                        : 'bg-slate-300',
                                )}
                              />
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">None</span>
                          )}
                          {health.faulty > 0 ? (
                            <span className="ml-1 text-[11px] font-medium text-red-600">{health.faulty} faulty</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {drain.alerts.length ? (
                          <Badge tone={drain.alerts.some((alert) => alert.severity === 'CRITICAL') ? 'red' : 'amber'}>
                            {drain.alerts.length} open
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">Clear</span>
                        )}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                          <Wrench className="h-3.5 w-3.5" />
                          {drain._count.tasks} total
                        </span>
                      </td>
                      <td>
                        <span className={cn('text-xs', isRecent(lastSeen, 15) ? 'text-emerald-700' : 'text-slate-500')}>
                          {lastSeen ? formatRelative(lastSeen) : 'No reading'}
                        </span>
                      </td>
                      <td className="text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                          Open <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sensor coverage</p>
            <p className="mt-2 text-sm text-slate-600">
              Litter, upstream and downstream sensors report independently. A missing type is shown rather than hidden.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Battery and health</p>
            <p className="mt-2 text-sm text-slate-600">
              Device health includes heartbeat status. Open a drain to see battery level, firmware and latest reading quality.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Maintenance context</p>
            <p className="mt-2 text-sm text-slate-600">
              Alert counts are current open signals. Task totals include all work ever raised for the asset.
            </p>
          </div>
        </div>
        <div className="mt-4 hidden gap-3 border-t border-slate-100 pt-4 sm:grid sm:grid-cols-3">
          <div>
            <ProgressBar value={summary.active ? (summary.active / Math.max(1, drains.length)) * 100 : 0} label="Active assets" />
          </div>
          <div>
            <ProgressBar
              value={summary.openAlerts ? Math.min(100, summary.openAlerts * 12) : 0}
              tone="amber"
              label="Alert pressure"
            />
          </div>
          <div>
            <ProgressBar
              value={summary.offlineDevices ? Math.min(100, summary.offlineDevices * 15) : 0}
              tone="red"
              label="Offline device pressure"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
