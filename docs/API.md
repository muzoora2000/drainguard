# DrainGuard API

Base URL (local): `http://localhost:4000`

All application endpoints are under `/api`. Requests and responses use JSON unless noted. The API is implemented with Express 4, Prisma and PostgreSQL.

## Conventions

### Success responses

Single resources:

```json
{ "data": { "id": "..." } }
```

Lists include pagination metadata:

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 25, "total": 0, "totalPages": 1 }
}
```

Create requests return `201`. Deletes and actions with no body return `204` where applicable.

### Error responses

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Invalid email" }],
    "requestId": "..."
  }
}
```

Common codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` / `DUPLICATE` (409), `RELATED_RECORDS` (409), `TOO_MANY_REQUESTS` (429), `INTERNAL_ERROR` (500). Every response includes `X-Request-Id`.

### Authentication

User endpoints require a Bearer access token:

```http
Authorization: Bearer <accessToken>
```

Device ingestion uses the device API key issued once at device creation:

```http
X-Device-Key: dg_...
```

or:

```http
Authorization: Device dg_...
```

### Roles

- `ADMIN`: full access, user/device/drain configuration, audit logs, CSV reports.
- `SUPERVISOR`: operations oversight, alert acknowledgement/resolution, task assignment, CSV reports.
- `TECHNICIAN`: assigned work, alert acknowledgement/resolution, device health updates, maintenance records.

### Pagination and filters

List endpoints accept `page` (default `1`) and `pageSize` (default `25`, max `100`). Date filters use ISO 8601 timestamps with an offset, e.g. `2026-01-15T12:00:00.000Z`.

## Health

### `GET /health` (public)

Returns service and database status. `200` when healthy, `503` when degraded.

```json
{
  "data": {
    "status": "ok",
    "service": "drainguard-api",
    "uptimeSeconds": 42,
    "checks": { "database": { "status": "ok", "latencyMs": 3 } }
  }
}
```

### `GET /api/system/health`

Authenticated operational status with table counts, SMS provider and scheduler configuration.

### `GET /api/system/audit-logs` (`ADMIN`)

Filters: `action`, `entityType`, `entityId`, `actorId`, `page`, `pageSize`.

## Authentication

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | Public | Email/password login |
| `POST` | `/api/auth/refresh` | Public | Rotate refresh token |
| `POST` | `/api/auth/logout` | Public | Revoke a refresh token |
| `GET` | `/api/auth/me` | Bearer | Current user |
| `POST` | `/api/auth/change-password` | Bearer | Change own password |

Login:

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@drainguard.local", "password": "DrainGuard123!" }
```

Response:

```json
{
  "data": {
    "user": { "id": "...", "email": "...", "name": "...", "role": "ADMIN" },
    "accessToken": "...",
    "refreshToken": "...",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "refreshExpiresIn": 604800
  }
}
```

Refresh tokens are single-use. Reusing a rotated token revokes all active sessions for that user.

## Users (`ADMIN`)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/users` | List users; filters `role`, `active`, `q` |
| `POST` | `/api/users` | Create user |
| `GET` | `/api/users/:id` | User detail with assignments |
| `PATCH` | `/api/users/:id` | Update profile, role, opt-ins, active, password |
| `GET` | `/api/users/:id/assignments` | List drain/zone assignments |
| `PUT` | `/api/users/:id/assignments` | Replace assignments |

Create body:

```json
{
  "email": "tech2@example.com",
  "password": "Password1",
  "name": "Field Technician",
  "role": "TECHNICIAN",
  "phone": "+254712345678",
  "smsOptIn": true,
  "inAppOptIn": true
}
```

Assignments body:

```json
{ "drainIds": ["drain_id"], "zones": ["Zone A"] }
```

Passwords must be 8–200 characters and contain at least one letter and one number. Deactivating a user or changing the password revokes their refresh tokens.

## Drains

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/drains` | Any user | List drains; filters `zone`, `status`, `q` |
| `POST` | `/api/drains` | `ADMIN` | Create drain and optional thresholds |
| `GET` | `/api/drains/:id` | Any user | Detail with devices, alerts, tasks and assignments |
| `PATCH` | `/api/drains/:id` | `ADMIN` | Update drain and/or thresholds |
| `DELETE` | `/api/drains/:id` | `ADMIN` | Soft-deactivate (`status=INACTIVE`) |
| `GET` | `/api/drains/:id/live` | Any user | Latest readings, rainfall, open alerts and open tasks |

Threshold object (all fields optional):

```json
{
  "basketFillPercent": 85,
  "waterRiseRateCmPerMin": 2,
  "levelDifferenceCm": 15,
  "differencePersistMinutes": 15,
  "intenseRainfallMmPerHour": 20,
  "rainfallLookbackMinutes": 30,
  "heartbeatTimeoutMinutes": 10,
  "repeatBlockageCount": 3,
  "repeatBlockageWindowDays": 30,
  "alertCooldownMinutes": 30,
  "escalationMinutes": 15,
  "riseRateWindowMinutes": 10,
  "levelMatchWindowMinutes": 5
}
```

Coordinates: `latitude` −90…90, `longitude` −180…180.

## Devices

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/devices` | Any user | List; filters `drainId`, `zone`, `type`, `healthStatus` |
| `POST` | `/api/devices` | `ADMIN` | Create device and return API key once |
| `GET` | `/api/devices/:id` | Any user | Detail and reading/alert counts |
| `PATCH` | `/api/devices/:id` | Admin/supervisor/technician | Name, health, battery, firmware |
| `POST` | `/api/devices/:id/rotate-key` | `ADMIN` | Rotate API key and return it once |

Create body:

```json
{
  "drainId": "drain_id",
  "name": "Litter sensor 1",
  "type": "LITTER",
  "serialNumber": "DG-001",
  "firmwareVersion": "1.2.0",
  "batteryPercent": 98
}
```

Device types: `LITTER`, `WATER_UPSTREAM`, `WATER_DOWNSTREAM`. Health: `UNKNOWN`, `HEALTHY`, `FAULTY`, `OFFLINE`. A drain can have at most one device of each type.

The response includes `apiKey` and a notice. The API key is hashed at rest and cannot be retrieved later.

## Sensor reading ingestion

### `POST /api/ingest/readings`

Device-authenticated. Sends one sample or a batch of up to 500 samples for the authenticated device. The reading type is derived from the device; a device cannot post another type.

Single sample:

```http
POST /api/ingest/readings
X-Device-Key: dg_...

{ "value": 64.5, "recordedAt": "2026-01-15T12:00:00.000Z", "externalId": "sensor-123" }
```

Batch:

```json
{
  "readings": [
    { "value": 64.5, "recordedAt": "2026-01-15T12:00:00.000Z", "externalId": "a" },
    { "value": 71.0, "recordedAt": "2026-01-15T12:01:00.000Z", "externalId": "b" }
  ]
}
```

Fields:

- `value` — litter fill percentage `0…100`, or water level in cm `0…5000`.
- `recordedAt` — optional, defaults to now. Must be within `INGEST_MAX_PAST_DAYS` and no more than `INGEST_MAX_FUTURE_MINUTES` ahead.
- `quality` — `OK`, `SUSPECT`, `BAD` (default `OK`). Rules only use `OK` readings.
- `externalId` — optional device-side identifier; duplicate IDs are counted, not stored twice.
- `batteryPercent`, `firmwareVersion` — optional device metadata.

Response:

```json
{
  "data": {
    "accepted": 2,
    "duplicates": 0,
    "deviceId": "...",
    "drainId": "...",
    "type": "LITTER",
    "lastReadingAt": "2026-01-15T12:01:00.000Z",
    "rulesQueued": true
  }
}
```

Ingestion updates the device heartbeat, marks non-faulty devices healthy, and queues an asynchronous rules evaluation for the drain.

## Rainfall

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/rainfall` | Any user | List; filters `zone`, `source`, `from`, `to` |
| `GET` | `/api/rainfall/latest?zone=Zone%20A` | Any user | Latest reading for a zone |
| `POST` | `/api/rainfall` | Admin/supervisor | Record manual/weather reading |
| `POST` | `/api/ingest/rainfall` | Device | Record a sensor reading for the device's zone |

Rainfall body:

```json
{
  "zone": "Zone A",
  "mmPerHour": 24.5,
  "recordedAt": "2026-01-15T12:00:00.000Z",
  "source": "MANUAL",
  "externalId": "weather-001",
  "notes": "Storm cell"
}
```

Sources: `SENSOR`, `MANUAL`, `WEATHER_API`. `(zone, externalId)` is unique for non-null external IDs; the ingestion endpoint returns `200` with `duplicate: true` for repeats.

## Alerts

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/alerts` | Any user | List; filters `status`, `severity`, `type`, `drainId`, `zone`, `from`, `to` |
| `GET` | `/api/alerts/:id` | Any user | Detail with notifications and tasks |
| `POST` | `/api/alerts/:id/acknowledge` | Any user | Acknowledge an `ACTIVE` alert |
| `POST` | `/api/alerts/:id/resolve` | Any user | Resolve with a note |

Alert types: `BASKET_NEARLY_FULL`, `HIGH_WATER`, `POSSIBLE_BLOCKAGE`, `SYSTEM_HEALTH`, `ENGINEERING_REVIEW`.
Severities: `INFO`, `WARNING`, `CRITICAL`. Statuses: `ACTIVE`, `ACKNOWLEDGED`, `RESOLVED`.

Resolve body:

```json
{ "resolutionNote": "Cleared the blockage and verified flow." }
```

Only `ACTIVE` alerts can be acknowledged. Acknowledged alerts stop escalation. Resolving clears the alert's unique `activeKey`, allowing a new alert of the same type after the cooldown.

## Maintenance tasks

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/tasks` | Any user | List; filters `status`, `priority`, `type`, `drainId`, `assignedToId`, `overdue`, `mine` |
| `POST` | `/api/tasks` | Admin/supervisor | Create task |
| `GET` | `/api/tasks/:id` | Any user | Detail with maintenance records |
| `PATCH` | `/api/tasks/:id` | Any user | Update/claim task |
| `DELETE` | `/api/tasks/:id` | Admin/supervisor | Cancel task |
| `POST` | `/api/tasks/:id/records` | Any user | Add completion record and mark task `DONE` |

Technicians see tasks assigned to them plus unassigned tasks. They may claim an unassigned task by setting status to `IN_PROGRESS` or adding a record. Supervisors/admins can assign any active user.

Statuses: `SCHEDULED`, `IN_PROGRESS`, `DONE`, `CANCELLED`. Priorities: `LOW`, `MEDIUM`, `HIGH`, `URGENT`.
Task types: `LITTER_REMOVAL`, `BLOCKAGE_INSPECTION`, `ENGINEERING_INVESTIGATION`, `DEVICE_REPAIR`.

Record body:

```json
{
  "notes": "Removed litter and checked outlet.",
  "actionsTaken": "Cleared 3 bags of litter.",
  "photos": ["https://example.com/photo.jpg"],
  "completedAt": "2026-01-15T12:30:00.000Z"
}
```

## Reports

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/reports/overview` | Any user | Dashboard aggregates; filters `from`, `to`, `zone` |
| `GET` | `/api/reports/alerts.csv` | Admin/supervisor | Alert CSV; filters `from`, `to`, `zone`, `status`, `severity`, `type` |
| `GET` | `/api/reports/tasks.csv` | Admin/supervisor | Task CSV; filters `from`, `to`, `zone`, `status`, `type` |

`/overview` defaults to the last 30 days and returns drain/device counts, alert counts by status/type/severity, average acknowledgement/resolution time, task completion/overdue counts, rainfall summary, top problem drains and a daily alert trend.

## Notifications

### `GET /api/notifications`

Current user's notification history. Filters: `channel` (`SMS`, `IN_APP`), `status`, `alertId`, plus pagination. The response also includes `recent`, the count of in-app notifications from the last 7 days.

## Server-sent events

### `GET /api/events`

Bearer-authenticated SSE stream. The server sends a `ready` event immediately and heartbeat comments every 25 seconds. Events currently published:

- `alert.created` — new alert with id, drain, type, severity, status, rule, message, createdAt.
- `alert.updated` — acknowledgement changes.
- `alert.resolved` — rule-based or manual resolution.
- `device.updated` — offline/health changes from the scheduler.

Clients should fall back to polling every 10 seconds when SSE is unavailable.

## Rules and scheduler

Device readings trigger an asynchronous rules pass. A cron sweep re-evaluates active drains, marks silent devices offline, retries failed SMS notifications and sends unacknowledged-alert escalations. Rule precedence:

1. Device health (`SYSTEM_HEALTH`), excluding unhealthy devices from other rules.
2. Rainfall context; intense rainfall suppresses blockage assumptions and only permits high-water alerts.
3. Basket fill, high water rise, sustained upstream/downstream difference.
4. Repeated blockages trigger an engineering review.

Faulty/offline devices and non-`OK` readings are excluded from measurements. Alerts are deduplicated by `(drain, type)` while open, with a configurable cooldown after resolution.

## SMS notifications

`SMS_PROVIDER` selects `mock` (default), `africastalking`, or `twilio`. Assigned users with `smsOptIn` receive primary SMS. If no assigned SMS contact exists, the drain's fallback contact, global fallback contacts, then `SMS_FALLBACK_PHONE` are used. Failed sends retry with exponential backoff (`SMS_RETRY_BASE_MINUTES`, `SMS_MAX_ATTEMPTS`) before falling back to escalation contacts. In-app notifications are created for assigned users with `inAppOptIn`.

## Environment

See `apps/api/.env.example`. Required at startup: `DATABASE_URL`, `DIRECT_URL`, `JWT_ACCESS_SECRET` (32+ chars), `JWT_REFRESH_SECRET` (32+ chars). Production requires provider credentials when `SMS_PROVIDER` is not `mock`.
