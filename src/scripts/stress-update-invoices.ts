import { request } from 'undici';
import { configuration } from '../shared/config/configuration';

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 20;
const CONFIRMATION_VALUE = 'yes';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StressConfiguration = {
  amount: string;
  baseUrl: URL;
  concurrency: number;
  ids: string[];
  itemRef: string;
  internalApiKey: string;
};

async function main(): Promise<void> {
  const config = loadConfiguration(process.env);
  const results = await Promise.all(
    Array.from({ length: config.concurrency }, (_, worker) => runWorker(config, worker)),
  );
  const succeeded = results.flat().filter((statusCode) => statusCode >= 200 && statusCode < 300).length;
  const failed = config.ids.length - succeeded;

  console.log(JSON.stringify({ event: 'stress_update_completed', count: config.ids.length, succeeded, failed }));
  if (failed > 0) process.exitCode = 1;
}

async function runWorker(config: StressConfiguration, worker: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = worker; index < config.ids.length; index += config.concurrency) {
    const id = config.ids[index];
    if (id) statuses.push(await updateInvoice(config, id));
  }
  return statuses;
}

async function updateInvoice(config: StressConfiguration, id: string): Promise<number> {
  const response = await request(new URL(`/v1/internal/invoices/${id}`, config.baseUrl), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-internal-api-key': config.internalApiKey,
    },
    body: JSON.stringify({
      total: config.amount,
      lines: [
        {
          description: 'Stress test invoice update',
          amount: config.amount,
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
  if (env.STRESS_UPDATE_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error('Set STRESS_UPDATE_CONFIRM=yes before updating real invoices.');
  }
  const app = configuration(env);
  return {
    amount: decimal(env.STRESS_UPDATE_AMOUNT ?? '2.00', 'STRESS_UPDATE_AMOUNT'),
    baseUrl: url(env.STRESS_BASE_URL ?? `http://localhost:${app.app.port}`, 'STRESS_BASE_URL'),
    concurrency: boundedInteger(env.STRESS_UPDATE_CONCURRENCY, DEFAULT_CONCURRENCY, MAX_CONCURRENCY),
    ids: invoiceIds(required(env, 'STRESS_INTERNAL_INVOICE_IDS')),
    itemRef: required(env, 'STRESS_QBO_ITEM_REF'),
    internalApiKey: app.secrets.auth.internalApiKey,
  };
}

function invoiceIds(value: string): string[] {
  const ids = [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0 || ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('Configuration error: STRESS_INTERNAL_INVOICE_IDS must be a comma-separated UUID list');
  }
  return ids;
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Configuration error: value must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function decimal(value: string, name: string): string {
  if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
    throw new Error(`Configuration error: ${name} must be a positive amount with up to two decimal places`);
  }
  return value;
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
      event: 'stress_update_failed',
      code:
        error instanceof Error && error.message === 'Set STRESS_UPDATE_CONFIRM=yes before updating real invoices.'
          ? 'STRESS_CONFIRMATION_REQUIRED'
          : 'STRESS_CONFIGURATION_INVALID',
    }),
  );
  process.exitCode = 1;
});
