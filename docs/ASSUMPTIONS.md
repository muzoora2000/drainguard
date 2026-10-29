# DrainGuard — Assumptions and Defaults

These assumptions are part of the product contract. They are stated so the behaviour of
the rules engine and UI is unambiguous. Changing one requires a code change, a test
change and an update to this document.

> DrainGuard supports earlier detection and more effective maintenance. It cannot
> prevent every flood, and the UI/documentation must not claim that it does.

---

## A1. Product scope

- DrainGuard is a monitoring and response-support system. It detects conditions that
  **may** indicate litter build-up, rising water, a blockage or faulty equipment.
- A `POSSIBLE_BLOCKAGE` alert is a prompt for inspection, not a diagnosis. Copy must use
  "possible blockage" or "needs inspection".
- The system does not control pumps, gates or drainage infrastructure and does not
  forecast floods.
- Weather-API polling is not implemented in v1. Rainfall can be ingested from a sensor,
  entered manually by an admin/supervisor, or posted with source `WEATHER_API`.

## A2. Sensor types and units

Each drain has three logical sensor roles:

| Type | Measurement | Unit / range |
|---|---|---|
| `LITTER` | Litter basket/trap fill | `litterFillPercent`, 0–100 % |
| `WATER_UPSTREAM` | Water depth at the upstream side of the drain | `waterLevelCm`, ≥ 0 cm |
| `WATER_DOWNSTREAM` | Water depth at the downstream side | `waterLevelCm`, ≥ 0 cm |

- Water level is depth above the channel invert, not elevation above sea level.
- A positive upstream-minus-downstream difference means upstream is higher, which is the
  blockage signal.
- Exactly one device of each type per drain is supported (database unique constraint).
  A drain may be commissioned with only some sensors; missing/unhealthy sensors simply
  disable the rules that need them.

## A3. Zones and rainfall

- `zone` is a free-text operational area (ward/zone). It is trimmed by the API; case is
  preserved.
- Rainfall is stored per zone and matched to drains by **exact** zone string.
- Seed data uses consistent zone names (`Zone A`, `Zone B`, ...).
- Intense-rainfall context uses the latest rainfall sample for the drain's zone inside
  `rainfallLookbackMinutes` (default 30). If there is no sample in the window, rainfall
  is treated as not intense (`latestMmPerHour = null`).
- The context is a single latest sample, not an average. A future weather integration can
  post more frequent samples.

## A4. Time and ordering

- API timestamps are ISO-8601 with a timezone (UTC recommended). The database stores
  UTC `timestamptz`.
- Device `recorded_at` is device time. Server time is authoritative for evaluation,
  cooldowns, heartbeat and escalation.
- Readings up to `INGEST_MAX_PAST_DAYS` (default 7) old are accepted.
- Readings more than `INGEST_MAX_FUTURE_MINUTES` (default 10) in the future are rejected.
- Late/out-of-order readings are stored and included in the next evaluation. They do not
  move `device.last_reading_at` backwards.
- UI timestamps are rendered in the browser's local timezone; the API always returns UTC.

## A5. Rule threshold defaults

Each drain has a `drain_thresholds` row. Defaults are applied at creation:

| Threshold | Default | Unit |
|---|---:|---|
| Basket fill | 85 | % |
| Water rise rate | 2.0 | cm/min |
| Upstream/downstream difference | 15 | cm |
| Difference persistence | 15 | min |
| Intense rainfall | 20 | mm/h |
| Rainfall lookback | 30 | min |
| Heartbeat timeout | 10 | min |
| Repeat-blockage count | 3 | alerts |
| Repeat-blockage window | 30 | days |
| Alert cooldown | 30 | min |
| Escalation delay | 15 | min |
| Rise-rate window | 10 | min |
| Level pairing window | 5 | min |

These are operational defaults, not hydrological standards. They must be tuned per site
by an admin. The rules engine reads them from the database on every evaluation.

## A6. Event handling contract

| Condition | Result | What must not happen |
|---|---|---|
| Basket fill ≥ threshold | `BASKET_NEARLY_FULL` (WARNING) + litter-removal task | — |
| Rise rate ≥ threshold | `HIGH_WATER` (CRITICAL) | — |
| Difference sustained for the whole persistence window | `POSSIBLE_BLOCKAGE` (WARNING) + blockage-inspection task | Not described as a confirmed blockage |
| Intense rainfall + high water | `HIGH_WATER` only | **No automatic blockage alert or blockage task** |
| Faulty/offline sensor | `SYSTEM_HEALTH` + device-repair task | Its readings must not feed other rules |
| Repeat blockages ≥ count in window | `ENGINEERING_REVIEW` + engineering-investigation task | No automatic resolution based on sensor normality |

High water during intense rainfall is still alerted because it is a hazard. Rainfall only
**suppresses the inference** that the water difference is caused by a blockage.

## A7. Rise-rate calculation

- Uses healthy water readings within `riseRateWindowMinutes` (default 10).
- Requires at least 2 readings spanning at least 60 seconds.
- `rate = (latest − oldest) / spanMinutes`, where read-order is by `recorded_at`.
- The maximum rate across the healthy upstream and downstream devices is compared with
  the threshold.
- If rainfall is intense, `triggerData.rainfall.intense = true`, and the alert is still
  `HIGH_WATER`.
- A negative rate (falling water) never opens an alert.

## A8. Sustained-difference calculation

- Both water devices must be healthy and have readings.
- Pair each upstream sample with the nearest downstream sample within
  `levelMatchWindowMinutes` (default 5).
- Valid pairs are ordered by time. The condition is sustained when, over the last
  `differencePersistMinutes` (default 15):
  - at least 3 valid pairs exist;
  - the oldest pair covers at least 90 % of the persistence window;
  - no gap between consecutive pairs exceeds `2 × levelMatchWindowMinutes`;
  - every pair has `upstream − downstream ≥ levelDifferenceCm`.
- If rainfall is intense, no new blockage decision is emitted. This is recorded as a
  suppressed evaluation in the audit log.
- Existing blockage alerts are not auto-resolved simply because it starts raining; they
  resolve when the measured difference returns below threshold with healthy sensors.

## A9. Device health

- `HEALTHY`: the device has reported a good reading recently, or an admin marked it
  healthy.
- `FAULTY`: an admin marked it faulty, or it posted a reading with `quality = FAULTY`.
  The reading is stored for audit but excluded from rules.
- `OFFLINE`: the scheduler marks the device offline when
  `now − last_seen_at > heartbeatTimeoutMinutes`.
- `UNKNOWN`: no successful reading yet. Excluded from rules and does not raise a health
  alert by itself (prevents commissioning alert storms).
- Ingestion refreshes `last_seen_at` and, for `quality = OK`, restores `HEALTHY`.
- Any `FAULTY`/`OFFLINE` device triggers one `SYSTEM_HEALTH` alert per drain (not per
  device); `trigger_data.devices` lists all affected devices.
- If all water devices are unusable, the `SYSTEM_HEALTH` severity is `CRITICAL`.

## A10. De-duplication and cooldown

- One open alert per drain per type. The `alerts.active_key` unique column enforces this.
- An acknowledged alert is still open and still counts for de-duplication.
- After an alert resolves, a new alert of the same drain/type is suppressed for
  `alertCooldownMinutes` (default 30) from the resolution time.
- Suppressed attempts are audited (`ALERT_SUPPRESSED`) with the observed condition.
- Cooldowns apply to auto-created alerts. Manual engineering review resolution does not
  immediately recreate the review; a new blockage event after resolution is required.

## A11. Auto-resolution

- Auto-resolution is based on the current healthy reading state, not on the alert being
  acknowledged.
- A resolved alert keeps its history, notifications, tasks and trigger data. Its
  `active_key` is cleared.
- If a condition persists but cannot be confirmed because sensors are offline, the alert
  is **not** auto-resolved (except `SYSTEM_HEALTH`, which resolves when devices recover).
- `ENGINEERING_REVIEW` is never auto-resolved.

## A12. Tasks

- Rules create tasks automatically, unassigned, for a supervisor to prioritise/assign:
  - basket → `LITTER_REMOVAL`
  - blockage → `BLOCKAGE_INSPECTION`
  - health → `DEVICE_REPAIR`
  - repeat blockage → `ENGINEERING_INVESTIGATION`
- Only one open (`SCHEDULED`/`IN_PROGRESS`) task of a given type per drain is created.
- Auto-created task priorities: `HIGH` generally; `MEDIUM` for a litter basket below
  95 %; engineering investigation `HIGH`.
- Completing a task requires a maintenance record with notes and actions taken.
- A maintenance record may only be attached to an existing task. Ad-hoc work should be
  represented by a manually created task.

## A13. Authentication and roles

- Staff authenticate with email/password. There is no self-registration; an admin creates
  users.
- Access tokens last 15 minutes; refresh tokens last 7 days and rotate on every refresh.
- Device nodes do not use JWT. They use `X-Device-Key` and are limited to ingestion.
- Technician visibility is limited to assigned drains/tasks. Supervisors and admins see
  everything. Engineers see engineering investigations and can add findings.
- "Assigned" means a `drain_assignments` row by drain or zone, or a directly assigned task.
- Deactivating a user immediately blocks login and refresh, but retains history.

## A14. SMS behaviour

- SMS recipients are responsible personnel (by drain or zone assignment) with
  `sms_opt_in = true`.
- The drain fallback contact, then global fallback contacts (`is_fallback_contact`), then
  `SMS_FALLBACK_PHONE` are used when no primary recipient exists or delivery fails.
- Phone numbers must be E.164 (`+254712345678`). Invalid numbers are rejected at user
  creation/update and skipped with a logged notification failure.
- The mock provider logs full messages to the API log and always succeeds. It is the
  default provider.
- Twilio and Africa's Talking are called over HTTPS with credentials from environment
  variables. Provider acceptance is recorded as `SENT`.
- Delivery receipts/status callbacks are **not** implemented in v1; `DELIVERED` exists for
  future use. Failures are retried with exponential backoff up to 3 attempts.
- Alert escalation: if an alert is still unacknowledged at `escalation_due_at`, fallback
  contacts are notified once and `escalated_at` is set. Acknowledgement cancels escalation.
- Users may opt out of SMS without losing in-app notifications.

## A15. API and real-time behaviour

- REST base path is `/api`; health check is `/health`.
- Lists are paginated (default 25, max 100) and ordered newest first unless stated.
- SSE is delivered over a `fetch` stream with an `Authorization` header. Polling every
  10 seconds is the fallback. Real-time events are advisory; clients re-query through
  RBAC-checked REST endpoints.
- The backend is deployed as a single instance for v1 because the scheduler and SSE hub
  are in-process. Database constraints still make writes safe if it is scaled, but
  events/jobs would need a shared bus/lock.

## A16. Performance and data volume

- Dashboard target: under 3 seconds for 100+ drains on a warm Neon connection.
- History requests are capped at a 7-day raw window; larger windows require aggregation.
- Readings are not deleted in v1. A retention policy can be added later.
- Map tiles come from OpenStreetMap; the app remains usable via the drain table if tiles
  are blocked.

## A17. UI copy and accessibility

- Status is conveyed by text and icon as well as colour (normal / warning / critical /
  offline).
- All pages have loading skeletons, empty states and error states with retry.
- The drain table is a keyboard-accessible alternative to the map.
- The product copy says it supports earlier detection and faster response; it does not
  claim to prevent floods.

## A18. Simulator

- The simulator authenticates as real devices using keys printed by the seed script.
- It can post normal readings and trigger each of the six scenarios:
  1. basket nearly full
  2. water rising unusually fast
  3. sustained level difference (possible blockage)
  4. intense rainfall with high water (proves no blockage assumption)
  5. faulty sensor / offline device
  6. repeat blockages leading to engineering review
- Scenario timing is accelerated for demos but still respects the configured thresholds
  (for example, the blockage scenario backdates readings across the persistence window
  or uses a shortened demo threshold set).
- The simulator is not part of the production runtime.

## A19. Data integrity and deletion

- Alert, telemetry, maintenance and audit history is immutable through the API.
- Drains with history are archived via `status = INACTIVE`, not hard-deleted.
- Users with history are deactivated, not hard-deleted.
- Hard deletes return `409` when foreign keys would be violated.

## A20. Out-of-scope integrations

- No automatic weather API polling, no inbound SMS commands, no email notifications, no
  push notifications, no PDF report export, no GIS boundaries, no billing/multi-tenancy.
- Reports are JSON endpoints consumed by the Reports page; a CSV export may be added
  later but is not part of the specified feature set.
