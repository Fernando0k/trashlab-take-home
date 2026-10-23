const { ExternalServiceError, errorDetails, isRetryable } = require('../dist/shared/errors/application-error');

describe('error handling', () => {
  it('preserves retry classification and a stable error code for external failures', () => {
    const error = new ExternalServiceError('QuickBooks rate limit', {
      code: 'EXTERNAL_RATE_LIMITED',
      retryable: true,
      statusCode: 429,
    });

    expect(isRetryable(error)).toBe(true);
    expect(errorDetails(error)).toEqual({
      code: 'EXTERNAL_RATE_LIMITED',
      retryable: true,
      statusCode: 429,
    });
  });

  it('does not expose an untrusted error message through durable error details', () => {
    const error = new Error('customer@example.test bearer super-secret-token');

    expect(errorDetails(error)).toEqual({ code: 'UNEXPECTED_ERROR', retryable: false });
  });

  it('persists only explicitly safe provider metadata', () => {
    const error = new ExternalServiceError('QuickBooks validation rejected the request', {
      code: 'EXTERNAL_CLIENT_ERROR',
      retryable: false,
      statusCode: 400,
      metadata: { providerCode: '2500', providerFaultType: 'ValidationFault' },
    });

    expect(errorDetails(error)).toEqual({
      code: 'EXTERNAL_CLIENT_ERROR',
      retryable: false,
      statusCode: 400,
      providerCode: '2500',
      providerFaultType: 'ValidationFault',
    });
  });
});
