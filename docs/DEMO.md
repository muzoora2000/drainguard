# DrainGuard Demo Guide

This guide covers the six-scenario simulator, the expected business outcome for each
scenario, and a short end-to-end demo flow for the web console.

> DrainGuard supports earlier detection and more effective maintenance. It does not
> prevent floods. A `POSSIBLE_BLOCKAGE` alert means the drain needs inspection; it is not
> a confirmed diagnosis.

## Prerequisites

- A migrated and seeded database.
- The API and web app running, or a deployed API and web URL.
- An administrator or supervisor account.
- The current password for that account. The seeded password is the value configured in
  `SEED_PASSWORD` when the seed was run.

Start locally in two terminals:

```bash
npm run api:dev
npm run web:dev
```

Open `http://localhost:5173` and confirm `http://localhost:4000/health` returns `200`.

## Connect the simulator

List the available scenarios:

```bash
npm run sim -- list
```

Run one scenario:

```bash
npm run sim -- run 1
```

Run every scenario:

```bash
npm run sim -- run all
```

Run against a remote API:

```bash
npm run sim -- run all \
  --api https://your-api.example.com \
  --email admin@drainguard.local \
  --password "<current password>"
```

Useful options:

| Option | Purpose |
|---|---|
| `--api <url>` | API base URL; defaults to `DRAINGUARD_API_URL` or `http://localhost:4000` |
| `--email <email>` | Login email; defaults to `DRAINGUARD_EMAIL` or the seeded administrator |
| `--password <value>` | Login password; defaults to `DRAINGUARD_PASSWORD` |
| `--drain <name|id>` | Override the scenario's default drain |
| `--keys <file>` | JSON device keys keyed by serial number |
| `--timeout <ms>` | Alert wait timeout; default `15000` |
| `--no-rotate-keys` | Fail when a key is missing instead of rotating it |

The simulator uses real device-key ingestion. When no saved key is available it rotates
the device key through the admin API. To preserve keys, create a JSON object mapping each
serial number from the seed output to its key, save it to a gitignored file such as
`simulator/device-keys.json`, and pass `--keys simulator/device-keys.json`.

## Scenarios

| # | Key | Drain | What the simulator sends | Expected outcome |
|---|---|---|---|---|
| 1 | `basket` | Market Square Drain | Litter fill rises from 76% to 92% | `BASKET_NEARLY_FULL` alert and litter-removal task |
| 2 | `high-water` | Riverside Road Drain | Upstream level rises 30 cm in five minutes | Critical `HIGH_WATER` alert |
| 3 | `blockage` | Station Approach Drain | Upstream stays 30 cm above downstream for 14 minutes | `POSSIBLE_BLOCKAGE` alert and blockage-inspection task |
| 4 | `rainfall` | Hillview Drain | 35 mm/h rainfall with rising water and a level difference | `HIGH_WATER` alert; no new blockage alert while rainfall is intense |
| 5 | `faulty-sensor` | Green Park Drain | Marks the upstream sensor `FAULTY`, then sends a litter reading | `SYSTEM_HEALTH` alert and device-repair task |
| 6 | `repeat-blockage` | Station Approach Drain | Creates three recent blockage alerts using shortened thresholds | `ENGINEERING_REVIEW` alert and engineering-investigation task |

Scenario 6 temporarily shortens persistence and cooldown thresholds and restores the
original values when it finishes.

## Suggested demo flow

1. Sign in as the administrator or supervisor.
2. Show the dashboard: active alerts, device status, recent readings and rainfall.
3. Run scenario 1. Open **Alerts**, show the basket alert, acknowledge it, then open the
   linked maintenance task and complete a maintenance record.
4. Run scenario 2 and show the critical high-water alert on the dashboard and drain
   detail chart.
5. Run scenario 3 and explain that the alert says **possible blockage** and needs
   inspection; resolve it with a note.
6. Run scenario 4 and show that intense rainfall suppresses a new blockage assumption
   while still raising high water.
7. Run scenario 5 and show the system-health alert and device-repair task. Restore the
   device to `HEALTHY` afterwards.
8. Run scenario 6 and show the engineering-review alert and investigation task.
9. Open **Reports** to show alert trends, response times, repeat problem drains and CSV
   downloads.
10. Use the sun/moon control in the header to demonstrate the light and dark themes.

## Clean-up between rehearsals

The scenarios intentionally leave operational data behind. For a clean rehearsal:

- Resolve the alerts and tasks created during the previous run.
- Restore any device marked `FAULTY` to `HEALTHY`.
- Re-run the seed only when you intend to reset the demo users, their passwords and the
  drains; this also rotates device API keys.
- Use a fresh Neon branch or database for a completely clean demo environment.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Invalid email or password` | Use the current account password, not an old seed value |
| `Drain not found` | Run `npm run db:seed` or pass an existing `--drain` |
| Device key errors | Save keys from the seed output or allow the simulator to rotate them |
| Alert wait timeout | Confirm the API scheduler is running with `JOBS_ENABLED=true` and the drain has all three devices |
| Remote requests fail | Confirm `--api` uses HTTPS and the API `/health` endpoint is healthy |
| Browser login fails but API is healthy | Confirm `CORS_ORIGINS` includes the exact web origin |
