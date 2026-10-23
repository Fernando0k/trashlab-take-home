const { Logger } = require('@nestjs/common');
const { of } = require('rxjs');
const { HttpRequestLoggingInterceptor } = require('../dist/shared/logging/http-request-logging.interceptor');

describe('HTTP request logging', () => {
  it('logs a completed request with only safe request metadata', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new HttpRequestLoggingInterceptor();
    const response = { locals: { requestId: 'request-1' }, statusCode: 302 };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path: '/v1/qbo/oauth/start' }),
        getResponse: () => response,
      }),
    };

    await new Promise((resolve, reject) => {
      interceptor.intercept(context, { handle: () => of(undefined) }).subscribe({ complete: resolve, error: reject });
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'http_request_completed',
        requestId: 'request-1',
        method: 'GET',
        routePath: '/v1/qbo/oauth/start',
        statusCode: 302,
      }),
    );
  });
});
