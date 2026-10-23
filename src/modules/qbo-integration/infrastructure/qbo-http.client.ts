import { Injectable } from '@nestjs/common';
import { PooledHttpClient } from '../../../shared/http/pooled-http.client';
import { AppConfig } from '../../../shared/config/app-config.service';
import { qboFaultMetadata } from './qbo-fault-metadata';

/**
 * QBO-specific facade over generic pooled HTTP transport.
 */
@Injectable()
export class QboHttpClient {
  constructor(
    private readonly http: PooledHttpClient,
    private readonly config: AppConfig,
  ) {}

  async accounting<T>(
    path: string,
    options: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  ): Promise<T> {
    return this.http.request<T>({
      origin: this.config.qbo.accountingApiOrigin,
      path,
      ...options,
      connections: this.config.app.qbo.accountingConnections,
      errorMetadata: qboFaultMetadata,
    });
  }

  async oauth<T>(path: string, options: { method: 'POST'; headers: Record<string, string>; body: string }): Promise<T> {
    return this.http.request<T>({
      origin: this.config.qbo.oauthOrigin,
      path,
      ...options,
      connections: this.config.app.qbo.oauthConnections,
    });
  }
}
