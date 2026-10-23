const { configuration } = require('../dist/shared/config/configuration');

const environment = (overrides = {}) => ({
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/qbo_sync',
  INTERNAL_API_KEY: 'internal-api-key-that-is-at-least-32-characters',
  QBO_SETUP_API_KEY: 'qbo-setup-key-that-is-at-least-32-characters',
  QBO_CLIENT_ID: 'client-id',
  QBO_REDIRECT_URI: 'http://localhost:3000/v1/qbo/oauth/callback',
  QBO_AUTHORIZATION_ENDPOINT: 'https://appcenter.intuit.com/connect/oauth2',
  QBO_ACCOUNTING_API_ORIGIN: 'https://sandbox-quickbooks.api.intuit.com',
  QBO_OAUTH_ORIGIN: 'https://oauth.platform.intuit.com',
  QBO_TOKEN_PATH: '/oauth2/v1/tokens/bearer',
  QBO_ACCOUNTING_SCOPE: 'com.intuit.quickbooks.accounting',
  QBO_CLIENT_SECRET: 'client-secret',
  QBO_WEBHOOK_VERIFIER_TOKEN: 'webhook-token',
  QBO_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  ...overrides,
});

describe('configuration', () => {
  it('fails at startup without a 32-byte encryption key for the shared QBO connection', () => {
    expect(() => configuration(environment({ QBO_TOKEN_ENCRYPTION_KEY: 'not-a-key' }))).toThrow(
      'QBO_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  });

  it('rejects a non-HTTPS QBO provider endpoint', () => {
    expect(() =>
      configuration(environment({ QBO_AUTHORIZATION_ENDPOINT: 'http://appcenter.intuit.com/connect/oauth2' })),
    ).toThrow('QBO_AUTHORIZATION_ENDPOINT must use HTTPS');
  });

  it('starts before OAuth connection because the callback persists it in the database', () => {
    const config = configuration(environment());
    expect(config.secrets.qbo.tokenEncryptionKey).toBe(Buffer.alloc(32).toString('base64'));
  });

  it('uses bounded PostgreSQL pool and timeout defaults that can be tuned per deployment', () => {
    const config = configuration(
      environment({
        APP_DB_POOL_MAX: '8',
        APP_DB_CONNECTION_TIMEOUT_MS: '4000',
        APP_DB_STATEMENT_TIMEOUT_MS: '20000',
        APP_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '25000',
      }),
    );

    expect(config.database).toMatchObject({
      poolMax: 8,
      connectionTimeoutMs: 4000,
      statementTimeoutMs: 20000,
      idleInTransactionTimeoutMs: 25000,
      applicationName: 'qbo-invoice-sync',
    });
    expect(config.secrets.database.url).toBe('postgres://postgres:postgres@localhost:5432/qbo_sync');
  });

  it('configures the durable outbox polling interval at startup', () => {
    const config = configuration(environment({ APP_SYNC_POLL_INTERVAL_MS: '3000' }));

    expect(config.app.sync.pollIntervalMs).toBe(3000);
  });
});
