import { request } from 'undici';
import { configuration } from '../shared/config/configuration';

const DEFAULT_REQUEST_COUNT = 10;
const DEFAULT_CONCURRENCY = 5;
const MAX_REQUEST_COUNT = 1_000;
const MAX_CONCURRENCY = 20;
const CONFIRMATION_VALUE = 'yes';

type StressConfiguration = {
  baseUrl: URL;
  concurrency: number;
  count: number;
  customerRef: string;
  itemRef: string;
  internalApiKey: string;
};

async function main(): Promise<void> {
  const config = loadConfiguration(process.env);
  const runId = Date.now().toString(36).toUpperCase();
  const results = await Promise.all(
    Array.from({ length: config.concurrency }, (_, worker) => runWorker(config, runId, worker)),
  );
  const succeeded = results.flat().filter((statusCode) => statusCode >= 200 && statusCode < 300).length;
  const failed = config.count - succeeded;

  console.log(JSON.stringify({ event: 'stress_create_completed', count: config.count, succeeded, failed }));
  if (failed > 0) process.exitCode = 1;
}

async function runWorker(config: StressConfiguration, runId: string, worker: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = worker; index < config.count; index += config.concurrency) {
    statuses.push(await createInvoice(config, `${runId}-${index + 1}`));
  }
  return statuses;
}

async function createInvoice(config: StressConfiguration, suffix: string): Promise<number> {
  const response = await request(new URL('/v1/internal/invoices', config.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-api-key': config.internalApiKey,
    },
    body: JSON.stringify({
      number: `STRESS-${suffix}`,
      customerRef: config.customerRef,
      issueDate: new Date().toISOString().slice(0, 10),
      currency: 'USD',
      total: '1.00',
      lines: [
        {
          description: 'Stress test invoice',
          amount: '1.00',
          qboItemRef: config.itemRef,
          quantity: '1',
        },
      ],
    }),
  });
  await response.body.dump();
  return response.statusCode;
}

function loadConfiguration(env: NodeJS.ProcessEnv): StressConfiguration {
  if (env.STRESS_CREATE_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error('Set STRESS_CREATE_CONFIRM=yes before creating real invoices.');
  }
  const app = configuration(env);
  return {
    baseUrl: url(env.STRESS_BASE_URL ?? `http://localhost:${app.app.port}`, 'STRESS_BASE_URL'),
    concurrency: boundedInteger(env.STRESS_CREATE_CONCURRENCY, DEFAULT_CONCURRENCY, MAX_CONCURRENCY),
    count: boundedInteger(env.STRESS_CREATE_COUNT, DEFAULT_REQUEST_COUNT, MAX_REQUEST_COUNT),
    customerRef: required(env, 'STRESS_QBO_CUSTOMER_REF'),
    itemRef: required(env, 'STRESS_QBO_ITEM_REF'),
    internalApiKey: app.secrets.auth.internalApiKey,
  };
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Configuration error: value must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Configuration error: ${name} is required`);
  return value;
}

function url(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Configuration error: ${name} must be an absolute URL`);
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'stress_create_failed',
      code:
        error instanceof Error && error.message === 'Set STRESS_CREATE_CONFIRM=yes before creating real invoices.'
          ? 'STRESS_CONFIRMATION_REQUIRED'
          : 'STRESS_CONFIGURATION_INVALID',
    }),
  );
  process.exitCode = 1;
});
