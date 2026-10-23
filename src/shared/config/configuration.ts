export type ApplicationConfig = {
  environment: 'development' | 'test' | 'production';
  port: number;
  http: {
    defaultConnections: number;
    headersTimeoutMs: number;
    bodyTimeoutMs: number;
    keepAliveTimeoutMs: number;
    keepAliveMaxTimeoutMs: number;
  };
  sync: {
    pollIntervalMs: number;
    jobLeaseMs: number;
    entityLeaseMs: number;
    entityLeaseRetryDelayMs: number;
    dependencyRetryDelayMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  };
  qbo: {
    accountingConnections: number;
    oauthConnections: number;
    accessTokenSafetyWindowMs: number;
    refreshLeaseDurationMs: number;
    refreshLeaseRetryDelayMs: number;
    refreshLeaseMaxAttempts: number;
    oauthStateTtlMs: number;
    oauthStartRateLimit: number;
    oauthStartRateLimitWindowMs: number;
  };
};

export type DatabaseConfig = {
  poolMax: number;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
  applicationName: string;
};

export type QuickBooksConfig = {
  clientId: string;
  redirectUri: string;
  authorizationEndpoint: string;
  accountingApiOrigin: string;
  oauthOrigin: string;
  tokenPath: string;
  accountingScope: string;
};

export type DatabaseSecretsConfig = {
  url: string;
};

export type AuthenticationSecretsConfig = {
  internalApiKey: string;
  qboSetupApiKey: string;
};

export type QuickBooksSecretsConfig = {
  clientSecret: string;
  webhookVerifierToken: string;
  tokenEncryptionKey: string;
};

export type SecretsConfig = {
  database: DatabaseSecretsConfig;
  auth: AuthenticationSecretsConfig;
  qbo: QuickBooksSecretsConfig;
};

export type ServiceConfig = {
  app: ApplicationConfig;
  database: DatabaseConfig;
  qbo: QuickBooksConfig;
  secrets: SecretsConfig;
};

type Environment = NodeJS.ProcessEnv;
const MINIMUM_SECRET_LENGTH = 32;
const AES_256_KEY_BYTES = 32;
const DEFAULT_DATABASE_POOL_MAX = 5;
const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;
const DEFAULT_DATABASE_APPLICATION_NAME = 'qbo-invoice-sync';

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Configuration error: ${name} is required`);
  return value;
}

function secret(env: Environment, name: string): string {
  const value = required(env, name);
  if (value.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`Configuration error: ${name} must be at least ${MINIMUM_SECRET_LENGTH} characters`);
  }
  return value;
}

function encryptionKey(env: Environment): string {
  const value = required(env, 'QBO_TOKEN_ENCRYPTION_KEY');
  if (Buffer.from(value, 'base64').length !== AES_256_KEY_BYTES) {
    throw new Error(
      `Configuration error: QBO_TOKEN_ENCRYPTION_KEY must be a base64-encoded ${AES_256_KEY_BYTES}-byte key`,
    );
  }
  return value;
}

function url(env: Environment, name: string): string {
  const value = required(env, name);
  try {
    new URL(value);
  } catch {
    throw new Error(`Configuration error: ${name} must be a valid URL`);
  }
  return value;
}

function httpsUrl(env: Environment, name: string): string {
  const value = url(env, name);
  if (new URL(value).protocol !== 'https:') throw new Error(`Configuration error: ${name} must use HTTPS`);
  return value;
}

function httpsOrigin(env: Environment, name: string): string {
  const value = httpsUrl(env, name);
  const parsed = new URL(value);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`Configuration error: ${name} must be an HTTPS origin without a path`);
  }
  return parsed.origin;
}

function path(env: Environment, name: string): string {
  const value = required(env, name);
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('?') || value.includes('#')) {
    throw new Error(`Configuration error: ${name} must be an absolute path without query or fragment`);
  }
  return value;
}

function port(value: string | undefined): number {
  if (value === undefined || value === '') return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('Configuration error: APP_PORT must be an integer from 1 to 65535');
  }
  return parsed;
}

function positiveInteger(env: Environment, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`Configuration error: ${name} must be a positive integer`);
  return parsed;
}

function optionalString(env: Environment, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value || fallback;
}

function environment(value: string | undefined): ApplicationConfig['environment'] {
  const resolved = value ?? 'development';
  if (resolved === 'development' || resolved === 'test' || resolved === 'production') return resolved;
  throw new Error('Configuration error: NODE_ENV must be development, test, or production');
}

export function databaseConfiguration(env: Environment = process.env): DatabaseConfig {
  return {
    poolMax: positiveInteger(env, 'APP_DB_POOL_MAX', DEFAULT_DATABASE_POOL_MAX),
    connectionTimeoutMs: positiveInteger(env, 'APP_DB_CONNECTION_TIMEOUT_MS', DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS),
    statementTimeoutMs: positiveInteger(env, 'APP_DB_STATEMENT_TIMEOUT_MS', DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS),
    idleInTransactionTimeoutMs: positiveInteger(
      env,
      'APP_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
      DEFAULT_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    ),
    applicationName: optionalString(env, 'APP_DB_APPLICATION_NAME', DEFAULT_DATABASE_APPLICATION_NAME),
  };
}

export function databaseSecretsConfiguration(env: Environment = process.env): DatabaseSecretsConfig {
  return { url: url(env, 'DATABASE_URL') };
}

export function configuration(env: Environment = process.env): ServiceConfig {
  return {
    app: {
      environment: environment(env.NODE_ENV),
      port: port(env.APP_PORT),
      http: {
        defaultConnections: positiveInteger(env, 'APP_HTTP_DEFAULT_CONNECTIONS', 4),
        headersTimeoutMs: positiveInteger(env, 'APP_HTTP_HEADERS_TIMEOUT_MS', 10_000),
        bodyTimeoutMs: positiveInteger(env, 'APP_HTTP_BODY_TIMEOUT_MS', 10_000),
        keepAliveTimeoutMs: positiveInteger(env, 'APP_HTTP_KEEP_ALIVE_TIMEOUT_MS', 30_000),
        keepAliveMaxTimeoutMs: positiveInteger(env, 'APP_HTTP_KEEP_ALIVE_MAX_TIMEOUT_MS', 60_000),
      },
      sync: {
        pollIntervalMs: positiveInteger(env, 'APP_SYNC_POLL_INTERVAL_MS', 2_000),
        jobLeaseMs: positiveInteger(env, 'APP_SYNC_JOB_LEASE_MS', 5 * 60_000),
        entityLeaseMs: positiveInteger(env, 'APP_SYNC_ENTITY_LEASE_MS', 5 * 60_000),
        entityLeaseRetryDelayMs: positiveInteger(env, 'APP_SYNC_ENTITY_LEASE_RETRY_DELAY_MS', 1_000),
        dependencyRetryDelayMs: positiveInteger(env, 'APP_SYNC_DEPENDENCY_RETRY_DELAY_MS', 60_000),
        maxRetries: positiveInteger(env, 'APP_SYNC_MAX_RETRIES', 10),
        retryBaseDelayMs: positiveInteger(env, 'APP_SYNC_RETRY_BASE_DELAY_MS', 1_000),
        retryMaxDelayMs: positiveInteger(env, 'APP_SYNC_RETRY_MAX_DELAY_MS', 3_600_000),
      },
      qbo: {
        accountingConnections: positiveInteger(env, 'APP_QBO_ACCOUNTING_CONNECTIONS', 4),
        oauthConnections: positiveInteger(env, 'APP_QBO_OAUTH_CONNECTIONS', 2),
        accessTokenSafetyWindowMs: positiveInteger(env, 'APP_QBO_ACCESS_TOKEN_SAFETY_WINDOW_MS', 2 * 60_000),
        refreshLeaseDurationMs: positiveInteger(env, 'APP_QBO_REFRESH_LEASE_DURATION_MS', 30_000),
        refreshLeaseRetryDelayMs: positiveInteger(env, 'APP_QBO_REFRESH_LEASE_RETRY_DELAY_MS', 250),
        refreshLeaseMaxAttempts: positiveInteger(env, 'APP_QBO_REFRESH_LEASE_MAX_ATTEMPTS', 8),
        oauthStateTtlMs: positiveInteger(env, 'APP_QBO_OAUTH_STATE_TTL_MS', 10 * 60_000),
        oauthStartRateLimit: positiveInteger(env, 'APP_QBO_OAUTH_START_RATE_LIMIT', 5),
        oauthStartRateLimitWindowMs: positiveInteger(env, 'APP_QBO_OAUTH_START_RATE_LIMIT_WINDOW_MS', 60_000),
      },
    },
    database: databaseConfiguration(env),
    qbo: {
      clientId: required(env, 'QBO_CLIENT_ID'),
      redirectUri: url(env, 'QBO_REDIRECT_URI'),
      authorizationEndpoint: httpsUrl(env, 'QBO_AUTHORIZATION_ENDPOINT'),
      accountingApiOrigin: httpsOrigin(env, 'QBO_ACCOUNTING_API_ORIGIN'),
      oauthOrigin: httpsOrigin(env, 'QBO_OAUTH_ORIGIN'),
      tokenPath: path(env, 'QBO_TOKEN_PATH'),
      accountingScope: required(env, 'QBO_ACCOUNTING_SCOPE'),
    },
    secrets: {
      database: databaseSecretsConfiguration(env),
      auth: {
        internalApiKey: secret(env, 'INTERNAL_API_KEY'),
        qboSetupApiKey: secret(env, 'QBO_SETUP_API_KEY'),
      },
      qbo: {
        clientSecret: required(env, 'QBO_CLIENT_SECRET'),
        webhookVerifierToken: required(env, 'QBO_WEBHOOK_VERIFIER_TOKEN'),
        tokenEncryptionKey: encryptionKey(env),
      },
    },
  };
}

export function validateEnvironment(env: Environment): Environment {
  configuration(env);
  return env;
}
