import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Dispatcher, Pool } from 'undici';
import { ExternalErrorMetadata, ExternalServiceError } from '../errors/application-error';
import { AppConfig } from '../config/app-config.service';

export interface HttpRequest {
  origin: string;
  path: string;
  method: Dispatcher.HttpMethod;
  headers: Record<string, string>;
  body?: string;
  connections?: number;
  errorMetadata?: (responseBody: string) => ExternalErrorMetadata;
}

/**
 * Reuses one bounded Undici pool per origin. Feature modules own request paths,
 * credentials, and response DTOs; this library owns only transport concerns.
 */
@Injectable()
export class PooledHttpClient implements OnApplicationShutdown {
  private readonly pools = new Map<string, Pool>();
  constructor(private readonly config: AppConfig) {}

  async request<T>(request: HttpRequest): Promise<T> {
    const pool = this.poolFor(request.origin, request.connections ?? this.config.app.http.defaultConnections);
    let response: Dispatcher.ResponseData;
    try {
      response = await pool.request({
        path: request.path,
        method: request.method,
        headers: request.headers,
        body: request.body,
        headersTimeout: this.config.app.http.headersTimeoutMs,
        bodyTimeout: this.config.app.http.bodyTimeoutMs,
      });
    } catch (error) {
      throw new ExternalServiceError('External HTTP request failed', {
        code: 'EXTERNAL_NETWORK_ERROR',
        retryable: true,
        cause: error,
      });
    }

    const text = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new ExternalServiceError(`External HTTP request returned ${response.statusCode}`, {
        code:
          response.statusCode === 429
            ? 'EXTERNAL_RATE_LIMITED'
            : response.statusCode >= 500
              ? 'EXTERNAL_SERVER_ERROR'
              : 'EXTERNAL_CLIENT_ERROR',
        retryable: response.statusCode === 429 || response.statusCode >= 500,
        statusCode: response.statusCode,
        metadata: safeErrorMetadata(request.errorMetadata, text),
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new ExternalServiceError('External HTTP response was not valid JSON', {
        code: 'EXTERNAL_INVALID_RESPONSE',
        retryable: true,
        cause: error,
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.close()));
  }

  private poolFor(origin: string, connections: number): Pool {
    const existing = this.pools.get(origin);
    if (existing) return existing;
    const pool = new Pool(origin, {
      connections,
      keepAliveTimeout: this.config.app.http.keepAliveTimeoutMs,
      keepAliveMaxTimeout: this.config.app.http.keepAliveMaxTimeoutMs,
    });
    this.pools.set(origin, pool);
    return pool;
  }
}

function safeErrorMetadata(
  parse: HttpRequest['errorMetadata'] | undefined,
  responseBody: string,
): ExternalErrorMetadata | undefined {
  if (!parse) return undefined;
  try {
    return parse(responseBody);
  } catch {
    return undefined;
  }
}
