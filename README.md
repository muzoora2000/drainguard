# DrainGuard

DrainGuard is a smart drainage monitoring and response-support platform. It combines
sensor readings, deterministic rules, SMS/in-app alerts, maintenance work and operational
reporting to support **earlier detection** of drainage problems and **more effective
maintenance**.

DrainGuard does **not** prevent floods. A `POSSIBLE_BLOCKAGE` alert means a drain **needs
inspection**; it is not a diagnosis.

## What is included

- React operations console with dashboard, drain map, alerts, tasks, engineering review,
  reports, system health and administration.
- Express API with JWT authentication, rotating refresh tokens, RBAC, validation, rate
  limiting, audit logging and device API keys.
- Deterministic rules engine for litter fill, high water, sustained level difference,
  rainfall context, device health and repeat blockages.
- PostgreSQL schema and migrations managed with Prisma, plus deterministic seed data.
- SMS delivery adapters for Africa's Talking, Twilio and a development mock provider.
- Background scheduler for offline detection, rule sweeps, notification retries,
  escalation and token cleanup.
- Six-scenario sensor simulator for demos and QA.
- Light and dark themes, persisted per browser.

## Architecture

- [Architecture overview](docs/ARCHITECTURE.md)
- [Entity relationship diagram](docs/ERD.md)
- [Assumptions and rule defaults](docs/ASSUMPTIONS.md)
- [API reference](docs/API.md)
- [Six-scenario demo guide](docs/DEMO.md)

## Technology

| Layer | Technology |
|---|---|
| Web | React 18, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS |
| Maps and charts | Leaflet, react-leaflet, Recharts |
| API | Node.js, Express 4, TypeScript, Zod, Pino |
| Database | PostgreSQL on Neon, Prisma 6 with the Neon serverless adapter |
| Authentication | JWT access tokens, rotating refresh tokens, bcrypt password hashes |
| Jobs | node-cron inside the API process |
| SMS | Africa's Talking, Twilio or `mock` |
| Tests | Vitest, Supertest |

## Quick start

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL 14+ or a Neon database

### Install

```bash
npm install
```

The root `postinstall` script generates the Prisma client when needed.

### Configure

```bash
cp apps/api/.env.example apps/api/.env
```

Set these values in `apps/api/.env`:

- `DATABASE_URL`: pooled PostgreSQL URL used by the API at runtime.
- `DIRECT_URL`: direct PostgreSQL URL used for migrations.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`: different random values of at least 32
  characters. Generate each with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `CORS_ORIGINS`: comma-separated browser origins, for example
  `http://localhost:5173`.
- `SEED_PASSWORD`: password assigned to the seeded demo users.
- `SMS_PROVIDER=mock` for local development.

See [apps/api/.env.example](apps/api/.env.example) for every option.

The web app does not need an environment file for local development. Vite proxies
`/api` and `/health` to `http://localhost:4000`; override that with
`VITE_DEV_API_PROXY` if needed.

### Prepare the database

Run from the repository root:

```bash
npm run db:migrate
npm run db:seed
```

The seed can be re-run for a demo reset, but it resets the three demo users' passwords to
the current `SEED_PASSWORD` and rotates all device API keys. It prints the demo credentials
and the new keys. Store device keys securely.

### Run locally

In one terminal:

```bash
npm run api:dev
```

In another terminal:

```bash
npm run web:dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:4000`; check
`http://localhost:4000/health`.

### Seeded accounts

| Role | Email |
|---|---|
| Administrator | `admin@drainguard.local` |
| Supervisor | `supervisor@drainguard.local` |
| Technician | `technician@drainguard.local` |

All three are seeded with the current `SEED_PASSWORD`. No engineer account is seeded.

## Common commands

| Command | Purpose |
|---|---|
| `npm run api:dev` | Start the API with watch mode |
| `npm run api:build` | Generate Prisma client and build the API |
| `npm run api:start` | Start the built API |
| `npm run api:typecheck` | Type-check the API |
| `npm run api:test` | Run API unit and integration tests |
| `npm run web:dev` | Start the Vite development server |
| `npm run web:build` | Type-check and build the web app |
| `npm run web:typecheck` | Type-check the web app |
| `npm run web:test` | Run web tests |
| `npm run sim -- list` | List the six simulator scenarios |
| `npm run sim -- run 1` | Run one scenario; use `all` for every scenario |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Apply committed migrations |
| `npm run db:migrate:dev` | Create a migration during development |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |

Run all verification before deployment:

```bash
npm run api:typecheck
npm run api:test
npm run web:typecheck
npm run web:test
npm run sim:typecheck
npm run sim:test
npm run api:build
npm run web:build
```

## Demo simulator

The simulator authenticates as an administrator or supervisor, sends readings through
real device-key ingestion, and verifies the resulting alerts.

```bash
npm run sim -- list
npm run sim -- run 1
npm run sim -- run all
npm run sim -- interactive
```

For a remote API:

```bash
npm run sim -- run all \
  --api https://your-api.example.com \
  --email admin@drainguard.local \
  --password "<current password>"
```

By default the simulator rotates device API keys when it does not have saved keys. Create
a JSON object mapping serial numbers to keys from the seed output, save it to a gitignored
file such as `simulator/device-keys.json`, and pass
`--keys simulator/device-keys.json` to avoid rotation. Use `--no-rotate-keys` to fail
instead of rotating.

The scenario script, expected outcomes and clean-up guidance are in
[docs/DEMO.md](docs/DEMO.md).

## Deployment

DrainGuard is designed for Vercel (web), Render (API and scheduler) and Neon
(PostgreSQL). The authoritative topology is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Neon

1. Create a Neon project and database.
2. Copy the pooled connection string to `DATABASE_URL`.
3. Copy the direct connection string to `DIRECT_URL`.
4. Include `sslmode=require` in both URLs.
5. Apply migrations with `npm run db:migrate`.
6. Seed only when intended: set `SEED_PASSWORD` and run `npm run db:seed`.

### Render API

Create a Web Service from the repository.

| Setting | Value |
|---|---|
| Root Directory | blank (repository root) |
| Build Command | `npm ci --include=dev && npm run api:build` |
| Start Command | `npm run api:start` |
| Health Check Path | `/health` |
| Pre-Deploy Command | `npm run db:migrate` (recommended) |

Required environment variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22.12.0` |
| `DATABASE_URL` | Neon pooled URL |
| `DIRECT_URL` | Neon direct URL |
| `CORS_ORIGINS` | `https://<your-web-app>.vercel.app` |
| `PUBLIC_API_URL` | `https://<your-api>.onrender.com` |
| `JWT_ACCESS_SECRET` | Random value, 32+ characters |
| `JWT_REFRESH_SECRET` | Different random value, 32+ characters |
| `JOBS_ENABLED` | `true` |
| `SMS_PROVIDER` | `mock`, `africastalking` or `twilio` |
| `SEED_PASSWORD` | Required only when running the seed |

Add the provider-specific SMS variables from
[apps/api/.env.example](apps/api/.env.example) when not using `mock`. Do not set `PORT`;
Render supplies it.

Run `npm run db:seed` once from a Render shell or locally with the production
`DATABASE_URL`, `DIRECT_URL` and `SEED_PASSWORD`.

The scheduler runs inside this single API instance. Keep one instance for v1; the SSE
event bus is in-process. `/health` returns `200` when the database is reachable and `503`
when it is degraded.

### Vercel web

Import the same repository into Vercel.

| Setting | Value |
|---|---|
| Root Directory | repository root |
| Install Command | Defined in `vercel.json` |
| Build Command | Defined in `vercel.json` |
| Output Directory | `apps/web/dist` |

Set `VITE_API_URL` to the Render API origin, for example
`https://drainguard-2o3e.onrender.com`. Vite bakes this value into the static build, so
redeploy after changing it.

`vercel.json` also rewrites all routes to `index.html` for client-side routing.

### Deployment checks

```bash
curl https://<your-api>.onrender.com/health
```

Expected: HTTP `200` with `"database": { "status": "ok", ... }`.

Then confirm the browser can log in, receive live updates and load the dashboard.

## Project structure

```text
apps/
  api/        Express API, Prisma schema/migrations/seed, rules engine, jobs, tests
  web/        React SPA, pages, shared UI, theme, API client, map, charts
simulator/    Device simulator and six-scenario demo runner
docs/         Architecture, ERD, assumptions, API and demo guides
scripts/      Install and build helpers
```

## Security and operations

- Never commit `.env` files, passwords, JWT secrets or device API keys.
- Use different access and refresh secrets and rotate them together with any exposed
  database credentials.
- Refresh tokens are single-use and rotated; reuse revokes the user's active sessions.
- Device API keys are hashed at rest and shown only when created or rotated.
- Admin-only routes include user, drain, device and audit-log management.
- Rate limits apply to API requests; trust proxy is enabled for Render.
- SMS delivery is `mock` by default. Configure provider credentials before enabling real
  SMS.

## Known limitations

- v1 runs as a single API instance because realtime events and cron jobs are in-process.
- Rainfall is stored per zone and matched by exact zone name.
- Weather-vendor polling, flood forecasting, pump/gate control and inbound SMS commands
  are out of scope.
- `npm audit` reports high-severity advisories in Prisma CLI development tooling. The fix
  requires a future Prisma major upgrade.
