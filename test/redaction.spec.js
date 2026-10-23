const { BadRequestException, ConflictException, Logger } = require('@nestjs/common');
const { ApiExceptionFilter } = require('../dist/shared/errors/api-exception.filter');
const { ExternalServiceError } = require('../dist/shared/errors/application-error');
const { SyncRepository } = require('../dist/modules/sync-orchestrator/infrastructure/sync.repository');

function hostFor(url) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return {
    response,
    host: {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, url }),
        getResponse: () => response,
      }),
    },
  };
}

describe('error redaction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not log an OAuth code, request URL, or raw external cause', () => {
    const secret = 'oauth-code-and-customer@example.test';
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, response } = hostFor(`/v1/qbo/oauth/callback?code=${secret}&state=state-value`);

    new ApiExceptionFilter().catch(
      new ExternalServiceError('provider failed', {
        code: 'EXTERNAL_SERVER_ERROR',
        retryable: true,
        cause: new Error(secret),
      }),
      host,
    );

    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(secret);
  });

  it('does not log or return an unexpected error message', () => {
    const secret = 'Bearer super-secret-token for customer@example.test';
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, response } = hostFor('/v1/internal/invoices');

    new ApiExceptionFilter().catch(new Error(secret), host);

    expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(secret);
  });

  it('does not return arbitrary HTTP exception messages', () => {
    const secret = 'customer@example.test';
    const { host, response } = hostFor('/v1/internal/invoices');

    new ApiExceptionFilter().catch(new BadRequestException(secret), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'HTTP_400', message: 'Invalid request' }),
    );
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(secret);
  });

  it('returns the approved duplicate-invoice error without database details', () => {
    const { host, response } = hostFor('/v1/internal/invoices');

    new ApiExceptionFilter().catch(new ConflictException({ errorCode: 'INVOICE_NUMBER_ALREADY_EXISTS' }), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'INVOICE_NUMBER_ALREADY_EXISTS',
        message: 'Invoice number already exists',
      }),
    );
  });

  it('persists only a controlled error code for a failed sync job', async () => {
    const update = vi.fn();
    const insert = vi.fn();
    const manager = { update, insert };
    const db = { transaction: vi.fn((callback) => callback(manager)) };
    const sync = new SyncRepository(
      db,
      { app: { sync: { maxRetries: 10, retryBaseDelayMs: 1, retryMaxDelayMs: 10 } } },
      {},
      {},
      {},
    );
    const secret = 'customer@example.test bearer super-secret-token';

    await sync.retry({ id: 'job-1', attempts: 0, entityType: 'invoice', entityId: 'invoice-1' }, new Error(secret));

    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      expect.objectContaining({ lastError: 'UNEXPECTED_ERROR' }),
    );
    expect(JSON.stringify([...update.mock.calls, ...insert.mock.calls])).not.toContain(secret);
  });
});
