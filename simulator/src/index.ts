import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  ApiError,
  DrainGuardApi,
  type Alert,
  type AlertType,
  type Device,
  type DeviceHealth,
  type DeviceType,
  type Drain,
  type DrainThresholds,
  type IngestResult,
  type ReadingSample,
} from './client';
import {
  SCENARIOS,
  findScenario,
  type ScenarioDefinition,
  type ScenarioResult,
  type ScenarioTools,
} from './scenarios';

interface CliOptions {
  command: 'help' | 'list' | 'run' | 'interactive';
  query: string;
  apiUrl: string;
  email: string;
  password: string;
  drain?: string;
  keysFile?: string;
  timeoutMs: number;
  rotateKeys: boolean;
}

const DEFAULT_EMAIL = 'admin@drainguard.local';
const DEFAULT_PASSWORD = 'DrainGuard123!';

function usage(): string {
  return [
    'DrainGuard simulator',
    '',
    'Usage:',
    '  npm run sim -- list',
    '  npm run sim -- run <1-6|name|all>',
    '  npm run sim -- interactive',
    '',
    'Options:',
    '  --api <url>          API base URL (default: DRAINGUARD_API_URL or http://localhost:4000)',
    '  --email <email>      Admin/supervisor login email',
    '  --password <value>   Login password',
    '  --drain <name|id>    Override the scenario drain',
    '  --keys <file>        JSON device keys keyed by serial number',
    '  --timeout <ms>       Alert wait timeout (default: 15000)',
    '  --no-rotate-keys     Fail if a device key is missing instead of rotating it',
    '',
    'Environment:',
    '  DRAINGUARD_API_URL, DRAINGUARD_EMAIL, DRAINGUARD_PASSWORD, DRAINGUARD_DEVICE_KEYS_FILE',
    '',
    'Device keys file:',
    '  { "DEMO-market-square-drain-LITTER": "dg_..." }',
  ].join('\n');
}

export function parseArgs(argv: string[]): CliOptions {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equals = withoutPrefix.indexOf('=');
    if (equals >= 0) {
      flags.set(withoutPrefix.slice(0, equals), withoutPrefix.slice(equals + 1));
      continue;
    }

    if (withoutPrefix === 'no-rotate-keys' || withoutPrefix === 'help') {
      flags.set(withoutPrefix, true);
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${withoutPrefix}`);
    }
    flags.set(withoutPrefix, value);
    index += 1;
  }

  const rawCommand = positionals[0] ?? (flags.has('help') ? 'help' : 'help');
  if (!['help', 'list', 'run', 'interactive'].includes(rawCommand)) {
    throw new Error(`Unknown command: ${rawCommand}`);
  }

  const allowed = new Set([
    'help',
    'api',
    'email',
    'password',
    'drain',
    'keys',
    'timeout',
    'no-rotate-keys',
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
  }

  const timeoutValue = flags.get('timeout');
  const timeoutMs = timeoutValue === undefined ? 15_000 : Number(timeoutValue);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    throw new Error('--timeout must be a number of milliseconds greater than or equal to 1000');
  }

  return {
    command: rawCommand as CliOptions['command'],
    query: positionals[1] ?? 'all',
    apiUrl: String(
      flags.get('api') ?? process.env.DRAINGUARD_API_URL ?? 'http://localhost:4000',
    ),
    email: String(flags.get('email') ?? process.env.DRAINGUARD_EMAIL ?? DEFAULT_EMAIL),
    password: String(
      flags.get('password') ?? process.env.DRAINGUARD_PASSWORD ?? DEFAULT_PASSWORD,
    ),
    drain: typeof flags.get('drain') === 'string' ? String(flags.get('drain')) : undefined,
    keysFile:
      typeof flags.get('keys') === 'string'
        ? String(flags.get('keys'))
        : process.env.DRAINGUARD_DEVICE_KEYS_FILE,
    timeoutMs,
    rotateKeys: !flags.has('no-rotate-keys'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadKeyFile(path: string): Promise<Map<string, string>> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const keys = new Map<string, string>();

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { serialNumber?: unknown }).serialNumber === 'string' &&
        typeof (entry as { apiKey?: unknown }).apiKey === 'string'
      ) {
        keys.set(
          (entry as { serialNumber: string }).serialNumber,
          (entry as { apiKey: string }).apiKey,
        );
      }
    }
    return keys;
  }

  if (typeof raw === 'object' && raw !== null) {
    for (const [serialNumber, apiKey] of Object.entries(raw)) {
      if (typeof apiKey === 'string') keys.set(serialNumber, apiKey);
    }
    return keys;
  }

  throw new Error('Device keys file must be an object or an array of { serialNumber, apiKey }');
}

function findDrain(drains: Drain[], query: string): Drain {
  const normalized = query.trim().toLowerCase();
  const match = drains.find(
    (drain) =>
      drain.id === query ||
      drain.name.toLowerCase() === normalized ||
      drain.name.toLowerCase().includes(normalized),
  );
  if (!match) throw new Error(`Drain not found: ${query}`);
  return match;
}

function deviceOfType(devices: Device[], type: DeviceType): Device {
  const device = devices.find((item) => item.type === type);
  if (!device) throw new Error(`Drain has no ${type} device`);
  return device;
}

async function resolveDeviceKeys(
  api: DrainGuardApi,
  devices: Device[],
  keyFile: Map<string, string>,
  rotateKeys: boolean,
): Promise<Map<DeviceType, string>> {
  const keys = new Map<DeviceType, string>();

  for (const type of ['LITTER', 'WATER_UPSTREAM', 'WATER_DOWNSTREAM'] as const) {
    const device = deviceOfType(devices, type);
    let key = keyFile.get(device.serialNumber);

    if (!key) {
      if (!rotateKeys) {
        throw new Error(`No API key for ${device.serialNumber}; add it or allow key rotation`);
      }
      console.log(`Rotating ${type} key for ${device.serialNumber}`);
      key = await api.rotateDeviceKey(device.id);
    }

    keys.set(type, key);
  }

  return keys;
}

function createTools(
  api: DrainGuardApi,
  drain: Drain,
  devices: Device[],
  keys: Map<DeviceType, string>,
  options: CliOptions,
): ScenarioTools {
  const getKey = (type: DeviceType): string => {
    const key = keys.get(type);
    if (!key) throw new Error(`No key for ${type}`);
    return key;
  };

  return {
    api,
    drain,
    devices,
    deviceKey: getKey,
    async post(type, samples): Promise<IngestResult> {
      return api.ingestReadings(getKey(type), samples);
    },
    async rainfall(mmPerHour, externalId, notes): Promise<void> {
      await api.ingestRainfall(getKey('LITTER'), mmPerHour, externalId, notes);
    },
    async findAlerts(type): Promise<Alert[]> {
      return api.listAlerts({ drainId: drain.id, type });
    },
    async ensureAlert(type, timeoutMs = options.timeoutMs): Promise<Alert> {
      const active = await api.listAlerts({
        drainId: drain.id,
        type,
        status: 'ACTIVE',
      });
      if (active[0]) return active[0];

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(500);
        const found = await api.listAlerts({
          drainId: drain.id,
          type,
          status: 'ACTIVE',
        });
        if (found[0]) return found[0];
      }

      throw new Error(`Timed out waiting for ${type} alert on ${drain.name}`);
    },
    async resolveAlert(alertId, note): Promise<void> {
      await api.resolveAlert(alertId, note);
    },
    async markDevice(type, health, reason): Promise<void> {
      await api.updateDevice(deviceOfType(devices, type).id, {
        healthStatus: health,
        healthReason: reason,
      });
    },
    async updateThresholds(thresholds: Partial<DrainThresholds>): Promise<void> {
      await api.updateDrainThresholds(drain.id, thresholds);
    },
    sleep,
    log(message): void {
      console.log(message);
    },
  };
}

async function runScenario(
  api: DrainGuardApi,
  scenario: ScenarioDefinition,
  options: CliOptions,
  keyFile: Map<string, string>,
): Promise<ScenarioResult> {
  console.log(`\nScenario ${scenario.id}: ${scenario.title}`);
  console.log(scenario.description);

  const drains = await api.listDrains();
  const drain = findDrain(drains, options.drain ?? scenario.drainName);
  const devices = await api.listDevices(drain.id);
  const keys = await resolveDeviceKeys(api, devices, keyFile, options.rotateKeys);

  console.log(`Drain: ${drain.name} (${drain.zone})`);
  const result = await scenario.run(createTools(api, drain, devices, keys, options));

  console.log(`PASS: ${result.summary}`);
  for (const alert of result.alerts) {
    console.log(`  ${alert.severity} ${alert.type} [${alert.status}] ${alert.id}`);
    if (alert.message) console.log(`  ${alert.message}`);
  }

  return result;
}

function selectedScenarios(query: string): ScenarioDefinition[] {
  if (query.toLowerCase() === 'all') return SCENARIOS;
  const scenario = findScenario(query);
  if (!scenario) throw new Error(`Unknown scenario: ${query}`);
  return [scenario];
}

async function runQueries(
  api: DrainGuardApi,
  query: string,
  options: CliOptions,
): Promise<void> {
  const scenarios = selectedScenarios(query);
  const keyFile = options.keysFile ? await loadKeyFile(options.keysFile) : new Map<string, string>();
  let failed = 0;

  for (const scenario of scenarios) {
    try {
      await runScenario(api, scenario, options, keyFile);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL: Scenario ${scenario.id} (${scenario.title}): ${message}`);
      if (scenarios.length === 1) throw error;
    }
  }

  if (failed > 0) process.exitCode = 1;
}

async function interactive(api: DrainGuardApi, options: CliOptions): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    let running = true;
    while (running) {
      console.log('\nAvailable scenarios:');
      for (const scenario of SCENARIOS) {
        console.log(`  ${scenario.id}. ${scenario.title}`);
      }
      console.log('  all. Run every scenario');
      console.log('  q. Quit');

      const answer = (await rl.question('Select a scenario [all]: ')).trim() || 'all';
      if (answer.toLowerCase() === 'q' || answer.toLowerCase() === 'quit') {
        running = false;
        continue;
      }

      try {
        await runQueries(api, answer, options);
      } catch (error) {
        const message = error instanceof ApiError
          ? `${error.message} (HTTP ${error.status})`
          : error instanceof Error
            ? error.message
            : String(error);
        console.error(`Scenario failed: ${message}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'help') {
    console.log(usage());
    return;
  }

  if (options.command === 'list') {
    for (const scenario of SCENARIOS) {
      console.log(`${scenario.id}. ${scenario.title} [${scenario.key}] - ${scenario.drainName}`);
      console.log(`   ${scenario.description}`);
    }
    return;
  }

  const api = new DrainGuardApi(options.apiUrl);
  const session = await api.login(options.email, options.password);
  console.log(`Connected to ${options.apiUrl} as ${session.user.email} (${session.user.role})`);

  if (options.command === 'interactive') {
    await interactive(api, options);
    return;
  }

  await runQueries(api, options.query, options);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof ApiError
      ? `${error.message} (HTTP ${error.status})`
      : error instanceof Error
        ? error.message
        : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
