import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  cn,
  enumLabel,
  formatDateTime,
  formatNumber,
  formatRelative,
  isOverdue,
  toDateTimeLocal,
} from '../lib/format';
import type {
  DrainListItem,
  MaintenanceRecord,
  MaintenanceTask,
  Paginated,
  TaskPriority,
  TaskStatus,
  TaskType,
  User,
} from '../lib/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  PriorityBadge,
  SeverityBadge,
  SidePanel,
  TaskStatusBadge,
  Tabs,
  useToast,
} from '../components/ui';

const taskTypes: TaskType[] = [
  'LITTER_REMOVAL',
  'BLOCKAGE_INSPECTION',
  'ENGINEERING_INVESTIGATION',
  'DEVICE_REPAIR',
];

const priorities: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

interface TaskFormProps {
  open: boolean;
  onClose: () => void;
  task?: MaintenanceTask | null;
  defaultDrainId?: string;
  defaultAlertId?: string;
  drains: DrainListItem[];
  users: User[];
  canAssign: boolean;
  onSaved: (task: MaintenanceTask) => void;
}

function TaskFormModal({
  open,
  onClose,
  task,
  defaultDrainId,
  defaultAlertId,
  drains,
  users,
  canAssign,
  onSaved,
}: TaskFormProps) {
  const { toast } = useToast();
  const [drainId, setDrainId] = useState('');
  const [type, setType] = useState<TaskType>('BLOCKAGE_INSPECTION');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [notes, setNotes] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDrainId(task?.drainId ?? defaultDrainId ?? '');
    setType(task?.type ?? 'BLOCKAGE_INSPECTION');
    setTitle(task?.title ?? '');
    setPriority(task?.priority ?? 'MEDIUM');
    setNotes(task?.notes ?? '');
    setAssignedToId(task?.assignedToId ?? '');
    setScheduledFor(toDateTimeLocal(task?.scheduledFor));
    setDueAt(toDateTimeLocal(task?.dueAt));
    setFormError(null);
    setTitleTouched(Boolean(task));
  }, [open, task, defaultDrainId]);

  const selectedDrain = drains.find((drain) => drain.id === drainId);

  useEffect(() => {
    if (!open || task || titleTouched) return;
    if (selectedDrain) setTitle(`${enumLabel(type)} · ${selectedDrain.name}`);
  }, [open, task, type, selectedDrain, titleTouched]);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ data: MaintenanceTask }>('/api/tasks', body),
    onSuccess: (response) => {
      toast('Maintenance task created.', 'success');
      onSaved(response.data);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<{ data: MaintenanceTask }>(`/api/tasks/${task?.id}`, body),
    onSuccess: (response) => {
      toast('Task updated.', 'success');
      onSaved(response.data);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!drainId) {
      setFormError('Select a drain for this task.');
      return;
    }
    if (!title.trim()) {
      setFormError('Enter a task title.');
      return;
    }

    if (task) {
      updateMutation.mutate({
        title: title.trim(),
        priority,
        notes: notes.trim() || undefined,
        ...(canAssign ? { assignedToId: assignedToId || null } : {}),
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
    } else {
      createMutation.mutate({
        drainId,
        type,
        title: title.trim(),
        priority,
        notes: notes.trim() || undefined,
        ...(canAssign && assignedToId ? { assignedToId } : {}),
        ...(defaultAlertId ? { alertId: defaultAlertId } : {}),
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit maintenance task' : 'Raise maintenance task'}
      description={task ? 'Update the work brief and scheduling.' : 'Create a clear, assignable piece of maintenance work.'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={pending}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <form id="task-form" className="space-y-4" onSubmit={submit}>
        {formError ? <FormError>{formError}</FormError> : null}
        {defaultAlertId && !task ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            This task will be linked to the alert you opened.
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Drain" htmlFor="task-drain">
            <select
              id="task-drain"
              className="field-select"
              value={drainId}
              onChange={(event) => setDrainId(event.target.value)}
              disabled={Boolean(task)}
              required
            >
              <option value="">Select a drain</option>
              {drains.map((drain) => (
                <option key={drain.id} value={drain.id}>
                  {drain.name} · {drain.zone}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Task type" htmlFor="task-type">
            <select
              id="task-type"
              className="field-select"
              value={type}
              onChange={(event) => setType(event.target.value as TaskType)}
              disabled={Boolean(task)}
            >
              {taskTypes.map((item) => (
                <option key={item} value={item}>
                  {enumLabel(item)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Title" htmlFor="task-title">
          <input
            id="task-title"
            className="field-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleTouched(true);
            }}
            maxLength={300}
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" htmlFor="task-priority">
            <select
              id="task-priority"
              className="field-select"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
            >
              {priorities.map((item) => (
                <option key={item} value={item}>
                  {enumLabel(item)}
                </option>
              ))}
            </select>
          </Field>
          {canAssign ? (
            <Field label="Assign to" htmlFor="task-assignee" hint="Leave unassigned to place the task in the shared queue.">
              <select
                id="task-assignee"
                className="field-select"
                value={assignedToId}
                onChange={(event) => setAssignedToId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {users
                  .filter((user) => user.active)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {enumLabel(user.role)}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <Field label="Assignment" htmlFor="task-assignment-note">
              <div id="task-assignment-note" className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500">
                {task?.assignedTo?.name ?? 'Unassigned until a technician claims it.'}
              </div>
            </Field>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scheduled for" htmlFor="task-scheduled">
            <input
              id="task-scheduled"
              type="datetime-local"
              className="field-input"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
            />
          </Field>
          <Field label="Due by" htmlFor="task-due">
            <input
              id="task-due"
              type="datetime-local"
              className="field-input"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Work brief" htmlFor="task-notes" hint="Include access notes, likely cause and what a responder should check.">
          <textarea
            id="task-notes"
            className="field-textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={5000}
          />
        </Field>
      </form>
    </Modal>
  );
}

interface RecordFormProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  onSaved: () => void;
}

function RecordFormModal({ open, onClose, taskId, onSaved }: RecordFormProps) {
  const { toast } = useToast();
  const [notes, setNotes] = useState('');
  const [actionsTaken, setActionsTaken] = useState('');
  const [completedAt, setCompletedAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNotes('');
    setActionsTaken('');
    setCompletedAt(toDateTimeLocal(new Date()));
    setFormError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ data: MaintenanceRecord }>(`/api/tasks/${taskId}/records`, {
        notes: notes.trim(),
        actionsTaken: actionsTaken.trim() || undefined,
        completedAt: completedAt ? new Date(completedAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast('Completion record saved and task marked done.', 'success');
      onSaved();
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!notes.trim()) {
      setFormError('Record what was checked or done before completing the task.');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Complete maintenance task"
      description="A completion record becomes the maintenance history for this drain."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="record-form" loading={mutation.isPending}>
            Save record and complete
          </Button>
        </>
      }
    >
      <form id="record-form" className="space-y-4" onSubmit={submit}>
        {formError ? <FormError>{formError}</FormError> : null}
        <Field label="Completion notes" htmlFor="record-notes" hint="State what was observed and the final condition.">
          <textarea
            id="record-notes"
            className="field-textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={5000}
            required
          />
        </Field>
        <Field label="Actions taken" htmlFor="record-actions" hint="Optional: cleared litter, removed debris, replaced sensor, referred to engineering.">
          <textarea
            id="record-actions"
            className="field-textarea"
            value={actionsTaken}
            onChange={(event) => setActionsTaken(event.target.value)}
            maxLength={5000}
          />
        </Field>
        <Field label="Completed at" htmlFor="record-completed">
          <input
            id="record-completed"
            type="datetime-local"
            className="field-input"
            value={completedAt}
            onChange={(event) => setCompletedAt(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

export function TasksPage() {
  const { session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [recordOpen, setRecordOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const role = session?.user.role ?? 'TECHNICIAN';
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const canWork = role !== 'ENGINEER';

  const status = (searchParams.get('status') ?? '') as '' | TaskStatus;
  const priority = (searchParams.get('priority') ?? '') as '' | TaskPriority;
  const type = (searchParams.get('type') ?? '') as '' | TaskType;
  const mine = searchParams.get('mine') === 'true';
  const overdue = searchParams.get('overdue') === 'true';
  const drainId = searchParams.get('drainId') ?? '';
  const taskId = searchParams.get('taskId') ?? '';
  const createOpen = searchParams.get('create') === '1';
  const createDrainId = searchParams.get('drainId') ?? '';
  const createAlertId = searchParams.get('alertId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const updateParam = (key: string, value: string, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (resetPage) next.delete('page');
    if (key !== 'taskId' && key !== 'create' && key !== 'drainId') next.delete('taskId');
    setSearchParams(next, { replace: true });
  };

  const openTask = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('taskId', id);
    next.delete('create');
    setSearchParams(next, { replace: true });
  };

  const closeTask = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('taskId');
    setSearchParams(next, { replace: true });
  };

  const openCreate = () => {
    const next = new URLSearchParams(searchParams);
    next.set('create', '1');
    next.delete('taskId');
    setSearchParams(next, { replace: true });
  };

  const closeCreate = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    next.delete('alertId');
    if (!taskId) next.delete('drainId');
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (taskId) next.set('taskId', taskId);
    setSearchParams(next, { replace: true });
  };

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'list', status, priority, type, mine, overdue, drainId, page],
    queryFn: () =>
      api.get<Paginated<MaintenanceTask>>('/api/tasks', {
        status: status || undefined,
        priority: priority || undefined,
        type: type || undefined,
        mine: mine ? 'true' : undefined,
        overdue: overdue ? 'true' : undefined,
        drainId: drainId || undefined,
        page,
        pageSize: 20,
      }),
  });

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.get<{ data: MaintenanceTask }>(`/api/tasks/${taskId}`),
    enabled: Boolean(taskId),
  });

  const drainsQuery = useQuery({
    queryKey: ['drains', 'task-form'],
    queryFn: () => api.get<Paginated<DrainListItem>>('/api/drains', { pageSize: 100, status: 'ACTIVE' }),
  });

  const usersQuery = useQuery({
    queryKey: ['users', 'task-form'],
    queryFn: () => api.get<Paginated<User>>('/api/users', { pageSize: 100, active: 'true' }),
    enabled: canManage && role === 'ADMIN',
  });

  const invalidateTasks = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['drain'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  const actionMutation = useMutation({
    mutationFn: ({ body, message }: { body: Record<string, unknown>; message: string }) =>
      api.patch<{ data: MaintenanceTask }>(`/api/tasks/${taskId}`, body).then(() => message),
    onSuccess: (message) => {
      toast(message, 'success');
      invalidateTasks();
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.delete<{ data: MaintenanceTask }>(`/api/tasks/${taskId}`),
    onSuccess: () => {
      setCancelOpen(false);
      toast('Task cancelled.', 'success');
      invalidateTasks();
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const task = taskQuery.data?.data;
  const openRecords =
    task?.records?.filter((record) => record.notes || record.actionsTaken).slice() ?? [];
  const hasFilters = Boolean(status || priority || type || mine || overdue || drainId);
  const drains = drainsQuery.data?.data ?? [];
  const users = usersQuery.data?.data ?? [];

  const taskSaved = (saved: MaintenanceTask) => {
    invalidateTasks();
    setEditOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    next.delete('alertId');
    next.set('taskId', saved.id);
    setSearchParams(next, { replace: true });
  };

  const alertForTask = task?.alert;
  const canViewAlert = role !== 'ENGINEER';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance tasks"
        description="Turn alert signals into scheduled work. Technicians can claim tasks, update progress and record the outcome against the drain."
        eyebrow="Field delivery"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void tasksQuery.refetch()}>
              Refresh
            </Button>
            {canManage ? (
              <Button size="sm" icon={Plus} onClick={openCreate}>
                Raise task
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={status}
            onChange={(value) => updateParam('status', value)}
            tabs={[
              { value: '', label: 'All statuses' },
              { value: 'SCHEDULED', label: 'Scheduled' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'DONE', label: 'Done' },
              { value: 'CANCELLED', label: 'Cancelled' },
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
            aria-label="Filter by task type"
          >
            <option value="">All task types</option>
            {taskTypes.map((item) => (
              <option key={item} value={item}>
                {enumLabel(item)}
              </option>
            ))}
          </select>
          <select
            className="field-select"
            value={priority}
            onChange={(event) => updateParam('priority', event.target.value)}
            aria-label="Filter by priority"
          >
            <option value="">All priorities</option>
            {priorities.map((item) => (
              <option key={item} value={item}>
                {enumLabel(item)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">
            <input
              type="checkbox"
              className="checkbox"
              checked={mine}
              onChange={(event) => updateParam('mine', event.target.checked ? 'true' : '')}
            />
            Only my tasks
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">
            <input
              type="checkbox"
              className="checkbox"
              checked={overdue}
              onChange={(event) => updateParam('overdue', event.target.checked ? 'true' : '')}
            />
            Overdue only
          </label>
        </div>

        {drainId ? (
          <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
            <Search className="h-3.5 w-3.5" />
            Showing tasks for one drain.
            <button type="button" onClick={() => updateParam('drainId', '')} className="ml-auto font-semibold hover:underline">
              Clear drain filter
            </button>
          </div>
        ) : null}
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Task queue</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatNumber(tasksQuery.data?.meta.total ?? 0)} matching tasks
              {role === 'TECHNICIAN' ? ' · assigned to you or unclaimed' : ''}
            </p>
          </div>
          <Badge tone="slate" dot>
            Priority and age ordered
          </Badge>
        </div>

        {tasksQuery.isLoading ? (
          <LoadingState rows={7} />
        ) : tasksQuery.isError ? (
          <ErrorState message={errorMessage(tasksQuery.error)} onRetry={() => void tasksQuery.refetch()} />
        ) : !tasksQuery.data?.data.length ? (
          <EmptyState
            title="No tasks match"
            description="Adjust the filters or create a maintenance task."
            icon={ClipboardList}
            action={
              canManage ? (
                <Button size="sm" icon={Plus} onClick={openCreate}>
                  Raise task
                </Button>
              ) : hasFilters ? (
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
                    <th>Task</th>
                    <th>Drain</th>
                    <th>Type</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assigned</th>
                    <th>Due</th>
                    <th className="text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksQuery.data.data.map((item) => (
                    <tr key={item.id} className="cursor-pointer" onClick={() => openTask(item.id)}>
                      <td>
                        <span className="font-medium text-slate-900">{item.title}</span>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Raised {formatRelative(item.createdAt)}
                          {item._count?.records ? ` · ${item._count.records} record${item._count.records === 1 ? '' : 's'}` : ''}
                        </p>
                      </td>
                      <td>
                        <span className="text-slate-800">{item.drain.name}</span>
                        <p className="mt-0.5 text-xs text-slate-400">{item.drain.zone}</p>
                      </td>
                      <td>
                        <Badge tone={item.type === 'ENGINEERING_INVESTIGATION' ? 'violet' : 'slate'}>
                          {enumLabel(item.type)}
                        </Badge>
                      </td>
                      <td>
                        <PriorityBadge priority={item.priority} />
                      </td>
                      <td>
                        <TaskStatusBadge status={item.status} />
                      </td>
                      <td>
                        <span className={cn('text-xs', item.assignedTo ? 'text-slate-600' : 'text-amber-700')}>
                          {item.assignedTo?.name ?? 'Unassigned'}
                        </span>
                      </td>
                      <td>
                        <span className={cn('text-xs', isOverdue(item.dueAt, item.status) ? 'font-semibold text-red-600' : 'text-slate-500')}>
                          {item.dueAt ? formatRelative(item.dueAt) : 'No due date'}
                        </span>
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
                page={tasksQuery.data.meta.page}
                totalPages={tasksQuery.data.meta.totalPages}
                total={tasksQuery.data.meta.total}
                onPageChange={(next) => updateParam('page', String(next), false)}
              />
            </div>
          </>
        )}
      </Card>

      <SidePanel
        open={Boolean(taskId)}
        onClose={closeTask}
        title={task?.title ?? 'Task detail'}
        description={task ? `${task.drain.name} · ${enumLabel(task.type)}` : 'Loading task'}
        footer={
          task && canWork ? (
            <>
              {canManage ? (
                <Button variant="secondary" icon={Wrench} onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
              ) : null}
              {task.status === 'SCHEDULED' ? (
                <Button
                  variant="secondary"
                  icon={UserPlus}
                  loading={actionMutation.isPending}
                  onClick={() =>
                    actionMutation.mutate({
                      body: { status: 'IN_PROGRESS' },
                      message: 'Task started.',
                    })
                  }
                >
                  Start task
                </Button>
              ) : null}
              {task.status === 'IN_PROGRESS' ? (
                <Button icon={CheckCircle2} onClick={() => setRecordOpen(true)}>
                  Complete
                </Button>
              ) : null}
              {task.status === 'DONE' && canManage ? (
                <Button
                  variant="secondary"
                  loading={actionMutation.isPending}
                  onClick={() =>
                    actionMutation.mutate({
                      body: { status: 'IN_PROGRESS' },
                      message: 'Task reopened.',
                    })
                  }
                >
                  Reopen
                </Button>
              ) : null}
              {canManage && task.status !== 'DONE' && task.status !== 'CANCELLED' ? (
                <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                  Cancel
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {taskQuery.isLoading ? (
          <LoadingState rows={5} />
        ) : taskQuery.isError ? (
          <ErrorState message={errorMessage(taskQuery.error)} onRetry={() => void taskQuery.refetch()} />
        ) : task ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              <Badge tone="slate">{enumLabel(task.type)}</Badge>
              {isOverdue(task.dueAt, task.status) ? <Badge tone="red">Overdue</Badge> : null}
            </div>

            {task.notes ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {task.notes}
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 px-3">
              <DetailRow label="Drain">
                <Link to={`/drains/${task.drain.id}`} onClick={closeTask} className="surface-link">
                  {task.drain.name}
                </Link>
              </DetailRow>
              <DetailRow label="Zone">{task.drain.zone}</DetailRow>
              <DetailRow label="Assigned to">{task.assignedTo?.name ?? <span className="text-amber-700">Unassigned</span>}</DetailRow>
              <DetailRow label="Created by">{task.createdBy?.name ?? 'System rule'}</DetailRow>
              <DetailRow label="Scheduled for">{task.scheduledFor ? formatDateTime(task.scheduledFor) : 'Not scheduled'}</DetailRow>
              <DetailRow label="Due by">
                <span className={isOverdue(task.dueAt, task.status) ? 'font-semibold text-red-600' : ''}>
                  {task.dueAt ? formatDateTime(task.dueAt) : 'No due date'}
                </span>
              </DetailRow>
              <DetailRow label="Started">{task.startedAt ? formatDateTime(task.startedAt) : 'Not started'}</DetailRow>
              <DetailRow label="Completed">{task.completedAt ? formatDateTime(task.completedAt) : 'Not complete'}</DetailRow>
            </div>

            {alertForTask ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Linked alert</h3>
                {canViewAlert ? (
                  <Link
                    to={`/alerts?alertId=${alertForTask.id}`}
                    onClick={closeTask}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{enumLabel(alertForTask.type)}</p>
                      <p className="text-xs text-slate-500">Alert status: {enumLabel(alertForTask.status)}</p>
                    </div>
                    <SeverityBadge severity={alertForTask.severity} />
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <p className="text-sm text-slate-700">{enumLabel(alertForTask.type)}</p>
                    <SeverityBadge severity={alertForTask.severity} />
                  </div>
                )}
              </div>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Maintenance records</h3>
                {canWork && task.status === 'IN_PROGRESS' ? (
                  <button type="button" onClick={() => setRecordOpen(true)} className="text-xs font-semibold text-brand-700 hover:underline">
                    Add record
                  </button>
                ) : null}
              </div>
              {openRecords.length ? (
                <div className="space-y-3">
                  {openRecords.map((record) => (
                    <div key={record.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800">{record.performedBy.name}</p>
                        <span className="text-xs text-slate-400">{formatDateTime(record.completedAt)}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{record.notes}</p>
                      {record.actionsTaken ? (
                        <p className="mt-2 rounded-lg bg-slate-50 p-2.5 text-xs leading-5 text-slate-600">
                          <span className="font-semibold text-slate-700">Actions: </span>
                          {record.actionsTaken}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                  <ClipboardList className="h-4 w-4" />
                  No maintenance record has been added.
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              Last updated {formatRelative(task.updatedAt)}
            </div>
          </div>
        ) : null}
      </SidePanel>

      <TaskFormModal
        open={createOpen}
        onClose={closeCreate}
        defaultDrainId={createDrainId}
        defaultAlertId={createAlertId}
        drains={drains}
        users={users}
        canAssign={role === 'ADMIN'}
        onSaved={taskSaved}
      />

      <TaskFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        task={task}
        drains={drains}
        users={users}
        canAssign={role === 'ADMIN'}
        onSaved={taskSaved}
      />

      <RecordFormModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        taskId={taskId}
        onSaved={invalidateTasks}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this task?"
        description="The task will remain in history with a cancelled status. Completed tasks cannot be cancelled."
        confirmLabel="Cancel task"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onClose={() => setCancelOpen(false)}
      />
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-700">{children}</span>
    </div>
  );
}
