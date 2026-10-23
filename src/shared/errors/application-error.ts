export type ErrorCode =
  | 'DEPENDENCY_UNAVAILABLE'
  | 'EXTERNAL_CLIENT_ERROR'
  | 'EXTERNAL_INVALID_RESPONSE'
  | 'EXTERNAL_NETWORK_ERROR'
  | 'EXTERNAL_RATE_LIMITED'
  | 'EXTERNAL_SERVER_ERROR';

export type ExternalErrorMetadata = {
  providerCode?: string;
  providerFaultType?: string;
};

export const PUBLIC_ERROR_CODE = {
  INVOICE_NUMBER_ALREADY_EXISTS: 'INVOICE_NUMBER_ALREADY_EXISTS',
} as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODE)[keyof typeof PUBLIC_ERROR_CODE];

export const PUBLIC_ERROR_MESSAGE: Record<PublicErrorCode, string> = {
  [PUBLIC_ERROR_CODE.INVOICE_NUMBER_ALREADY_EXISTS]: 'Invoice number already exists',
};

export class ExternalServiceError extends Error {
  readonly name = 'ExternalServiceError';

  constructor(
    message: string,
    readonly options: {
      code: ErrorCode;
      retryable: boolean;
      statusCode?: number;
      metadata?: ExternalErrorMetadata;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
  }

  get code(): ErrorCode {
    return this.options.code;
  }

  get retryable(): boolean {
    return this.options.retryable;
  }

  get statusCode(): number | undefined {
    return this.options.statusCode;
  }

  get metadata(): ExternalErrorMetadata | undefined {
    return this.options.metadata;
  }
}

/** An expected unavailable dependency. The caller should defer, not fail, work. */
export class DependencyUnavailableError extends Error {
  readonly name = 'DependencyUnavailableError';

  constructor(readonly code: 'DEPENDENCY_UNAVAILABLE') {
    super(code);
  }
}

const TRANSIENT_NODE_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export function isRetryable(error: unknown): boolean {
  if (error instanceof DependencyUnavailableError) return true;
  if (error instanceof ExternalServiceError) return error.retryable;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return TRANSIENT_NODE_CODES.has(String(error.code));
  }
  return error instanceof Error && /\b(ECONNRESET|EAI_AGAIN|ETIMEDOUT)\b/.test(error.message);
}

/**
 * This crosses logging and persistence boundaries. Never add an error message,
 * cause, URL, headers, or request body here: those values are untrusted.
 */
export function errorDetails(error: unknown): {
  code: ErrorCode | 'TRANSIENT_ERROR' | 'UNEXPECTED_ERROR';
  retryable: boolean;
  statusCode?: number;
  providerCode?: string;
  providerFaultType?: string;
} {
  if (error instanceof DependencyUnavailableError) {
    return { code: error.code, retryable: true };
  }
  if (error instanceof ExternalServiceError) {
    return {
      code: error.code,
      retryable: error.retryable,
      ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
      ...(error.metadata?.providerCode === undefined ? {} : { providerCode: error.metadata.providerCode }),
      ...(error.metadata?.providerFaultType === undefined
        ? {}
        : { providerFaultType: error.metadata.providerFaultType }),
    };
  }
  return {
    code: isRetryable(error) ? 'TRANSIENT_ERROR' : 'UNEXPECTED_ERROR',
    retryable: isRetryable(error),
  };
}
