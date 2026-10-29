import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Gauge,
  RefreshCw,
  Repeat2,
  ShieldCheck,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, formatNumber, formatRelative, isOverdue } from '../lib/format';
import type {
  AlertSummary,
  DrainListItem,
  MaintenanceTask,
  Paginated,
} from '../lib/types';
import {
  AlertStatusBadge,
  AlertTypeBadge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PriorityBadge,
  SeverityBadge,
  StatCard,
  TaskStatusBadge,
  Tabs,
} from '../components/ui';

export function EngineeringPage() {
  const { session } = useAuth();
  const role = session?.user.role;
  const canViewAlerts = role !== 'ENGINEER';
  const [view, setView] = useState<'open' | 'closed' | 'all'>('open');

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'engineering'],
    queryFn: () =>
      api.get<Paginated<MaintenanceTask>>('/api/tasks', {
        type: 'ENGINEERING_INVESTIGATION',
        pageSize: 100,
      }),
  });

  const alertsQuery = useQuery({
    queryKey: ['alerts', 'engineering-reviews'],
    queryFn: () =>
      api.get<Paginated<AlertSummary>>('/api/alerts', {
        type: 'ENGINEERING_REVIEW',
        pageSize: 20,
      }),
    enabled: canViewAlerts,
  });

  const drainsQuery = useQuery({
    queryKey: ['drains', 'engineering-context'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 100 }),
    enabled: role === 'ENGINEER',
  });

  const tasks = tasksQuery.data?.data ?? [];
  const openTasks = tasks.filter((task) => task.status === 'SCHEDULED' || task.status === 'IN_PROGRESS');
  const closedTasks = tasks.filter((task) => task.status === 'DONE' || task.status === 'CANCELLED');
  const visibleTasks =
    view === 'open' ? openTasks : view === 'closed' ? closedTasks : tasks;

  const stats = useMemo(() => {
    return {
      open: openTasks.length,
      inProgress: tasks.filter((task) => task.status === 'IN_PROGRESS').length,
      overdue: openTasks.filter((task) => isOverdue(task.dueAt, task.status)).length,
      done: tasks.filter((task) => task.status === 'DONE').length,
      repeatAlerts: alertsQuery.data?.meta.total ?? 0,
    };
  }, [tasks, openTasks, alertsQuery.data]);

  const engineerContext = (drainsQuery.data?.data ?? [])
    .filter((drain) => drain.alerts.some((alert) => alert.type === 'ENGINEERING_REVIEW' || alert.type === 'POSSIBLE_BLOCKAGE'))
    .slice(0, 8);

  const reset = () => {
    void tasksQuery.refetch();
    if (canViewAlerts) void alertsQuery.refetch();
    if (role === 'ENGINEER') void drainsQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engineering review"
        description="Investigate repeated blockage patterns and structural drainage issues. A review is triggered by repeated possible blockages, not by a confirmed defect."
        eyebrow="Asset performance"
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={reset}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open investigations"
          value={formatNumber(stats.open)}
          hint={`${formatNumber(stats.inProgress)} currently in progress`}
          icon={FlaskConical}
          tone={stats.open ? 'violet' : 'brand'}
        />
        <StatCard
          label="Overdue reviews"
          value={formatNumber(stats.overdue)}
          hint="Open investigations past their due date"
          icon={AlertTriangle}
          tone={stats.overdue ? 'red' : 'brand'}
        />
        <StatCard
          label="Completed reviews"
          value={formatNumber(stats.done)}
          hint="Investigations with a maintenance record"
          icon={CheckCircle2}
          tone="blue"
        />
        <StatCard
          label="Repeat signals"
          value={canViewAlerts ? formatNumber(stats.repeatAlerts) : '—'}
          hint={canViewAlerts ? 'Engineering review alerts on record' : 'Available in the investigation brief'}
          icon={Repeat2}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card padded={false}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Investigation queue</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Engineering tasks raised automatically after repeated blockage signals
              </p>
            </div>
            <Tabs
              value={view}
              onChange={(value) => setView(value as 'open' | 'closed' | 'all')}
              tabs={[
                { value: 'open', label: 'Open', count: openTasks.length },
                { value: 'closed', label: 'Closed', count: closedTasks.length },
                { value: 'all', label: 'All', count: tasks.length },
              ]}
            />
          </div>

          {tasksQuery.isLoading ? (
            <LoadingState rows={6} />
          ) : tasksQuery.isError ? (
            <ErrorState message={errorMessage(tasksQuery.error)} onRetry={() => void tasksQuery.refetch()} />
          ) : visibleTasks.length === 0 ? (
            <EmptyState
              title={view === 'open' ? 'No open investigations' : 'No investigations in this view'}
              description="Repeated blockage signals will create an engineering investigation automatically."
              icon={FlaskConical}
            />
          ) : (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Investigation</th>
                    <th>Drain</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Due</th>
                    <th className="text-right">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <Link to={`/tasks?taskId=${task.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {task.title}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Raised {formatRelative(task.createdAt)}
                        </p>
                      </td>
                      <td>
                        <span className="text-slate-800">{task.drain.name}</span>
                        <p className="text-xs text-slate-400">{task.drain.zone}</p>
                      </td>
                      <td>
                        <PriorityBadge priority={task.priority} />
                      </td>
                      <td>
                        <TaskStatusBadge status={task.status} />
                      </td>
                      <td>
                        <span className="text-xs text-slate-500">{task.assignedTo?.name ?? 'Unassigned'}</span>
                      </td>
                      <td>
                        <span className={cn('text-xs', isOverdue(task.dueAt, task.status) ? 'font-semibold text-red-600' : 'text-slate-500')}>
                          {task.dueAt ? formatRelative(task.dueAt) : '—'}
                        </span>
                      </td>
                      <td className="text-right">
                        <Link to={`/tasks?taskId=${task.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
                          Open <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card padded={false}>
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Repeat2 className="h-4 w-4 text-violet-500" />
                Repeat blockage signals
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {canViewAlerts ? 'Engineering review alerts raised by the rule engine' : 'Open drainage signals in your investigation context'}
              </p>
            </div>
            {canViewAlerts ? (
              alertsQuery.isLoading ? (
                <LoadingState rows={4} />
              ) : alertsQuery.isError ? (
                <ErrorState message={errorMessage(alertsQuery.error)} onRetry={() => void alertsQuery.refetch()} />
              ) : alertsQuery.data?.data.length ? (
                <div className="divide-y divide-slate-100">
                  {alertsQuery.data.data.map((alert) => (
                    <Link
                      key={alert.id}
                      to={`/alerts?alertId=${alert.id}`}
                      className="block px-5 py-3.5 transition hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertStatusBadge status={alert.status} />
                        <SeverityBadge severity={alert.severity} />
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-slate-800">{alert.drain?.name}</p>
                      <p className="text-xs text-slate-500">
                        {alert.drain?.zone} · {formatRelative(alert.createdAt)}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="No review alerts" description="No repeat-blockage threshold has been reached." icon={ShieldCheck} />
              )
            ) : engineerContext.length ? (
              <div className="divide-y divide-slate-100">
                {engineerContext.map((drain) => (
                  <Link
                    key={drain.id}
                    to={`/drains/${drain.id}`}
                    className="block px-5 py-3.5 transition hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{drain.name}</p>
                        <p className="text-xs text-slate-500">
                          {drain.zone} · {drain.alerts.length} open signal{drain.alerts.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <AlertTypeBadge type={drain.alerts[0]?.type ?? 'POSSIBLE_BLOCKAGE'} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No open drainage signals"
                description="Open investigations and maintenance records remain available in the queue."
                icon={Gauge}
              />
            )}
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-slate-900">How escalation works</h2>
            <ol className="mt-4 space-y-3">
              {[
                ['Possible blockage', 'The sustained level-difference rule raises a warning when upstream stays above downstream.'],
                ['Inspection', 'A high-priority blockage inspection task is created for field response.'],
                ['Repeat count', 'Multiple possible blockages within the configured window trigger an engineering review.'],
                ['Root cause', 'Engineering investigates asset condition and records findings against the task.'],
              ].map(([title, text], index) => (
                <li key={title} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-50 text-[11px] font-bold text-violet-700">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              A possible blockage indicates that an inspection is needed. It is not a confirmed structural defect.
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Investigation records</p>
              <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500">
                Findings, actions and completion notes are captured against each engineering task. Use the task record
                to document root cause, temporary mitigation and any follow-up work.
              </p>
            </div>
          </div>
          <Link to="/tasks?type=ENGINEERING_INVESTIGATION" className="surface-link text-xs">
            Open all in maintenance
          </Link>
        </div>
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Open</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{formatNumber(openTasks.length)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">In progress</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{formatNumber(stats.inProgress)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Completed</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{formatNumber(stats.done)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
