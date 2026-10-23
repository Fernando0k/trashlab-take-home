import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../../shared/config/app-config.service';
import { DependencyUnavailableError, ExternalServiceError } from '../../../shared/errors/application-error';
import { basicAuthorization } from '../../../shared/auth/basic-authorization';
import { QboHttpClient } from '../infrastructure/qbo-http.client';
import { QboTokenCipher } from '../infrastructure/qbo-token-cipher';
import { QboConnectionEntity } from '../infrastructure/persistence/qbo-connection.entity';

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
};

@Injectable()
export class QboConnectionService {
  private readonly cache = new Map<string, { accessToken: string; expiresAt: number }>();
  private readonly owner = randomUUID();
  constructor(
    private readonly config: AppConfig,
    private readonly http: QboHttpClient,
    private readonly cipher: QboTokenCipher,
    @InjectRepository(QboConnectionEntity) private readonly connections: Repository<QboConnectionEntity>,
  ) {}

  async saveAuthorization(realmId: string, tokens: TokenResponse): Promise<void> {
    await this.connections.save({
      realmId,
      encryptedAccessToken: this.cipher.encrypt(tokens.access_token),
      encryptedRefreshToken: this.cipher.encrypt(tokens.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      refreshTokenExpiresAt: tokens.x_refresh_token_expires_in
        ? new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000)
        : null,
      tokenVersion: 1,
      refreshLeaseOwner: null,
      refreshLeaseExpiresAt: null,
      status: 'ACTIVE',
    });
    this.cache.set(realmId, { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
  }

  async activeRealmId(): Promise<string> {
    const connection = await this.connections.findOneBy({ status: 'ACTIVE' });
    if (!connection) throw new DependencyUnavailableError('DEPENDENCY_UNAVAILABLE');
    return connection.realmId;
  }

  async accessToken(realmId: string, forceReload = false, forceRefresh = false): Promise<string> {
    const cached = this.cache.get(realmId);
    if (
      !forceReload &&
      !forceRefresh &&
      cached &&
      cached.expiresAt > Date.now() + this.config.app.qbo.accessTokenSafetyWindowMs
    ) {
      return cached.accessToken;
    }
    for (let attempt = 0; attempt < this.config.app.qbo.refreshLeaseMaxAttempts; attempt += 1) {
      const connection = await this.connections.findOneBy({ realmId });
      if (!connection || connection.status !== 'ACTIVE') {
        throw new DependencyUnavailableError('DEPENDENCY_UNAVAILABLE');
      }
      const accessToken = this.cipher.decrypt(connection.encryptedAccessToken);
      if (
        !forceRefresh &&
        connection.accessTokenExpiresAt.getTime() > Date.now() + this.config.app.qbo.accessTokenSafetyWindowMs
      ) {
        this.cache.set(realmId, { accessToken, expiresAt: connection.accessTokenExpiresAt.getTime() });
        return accessToken;
      }
      const acquired = await this.connections.update(
        [
          { realmId, status: 'ACTIVE', tokenVersion: connection.tokenVersion, refreshLeaseExpiresAt: IsNull() },
          {
            realmId,
            status: 'ACTIVE',
            tokenVersion: connection.tokenVersion,
            refreshLeaseExpiresAt: LessThan(new Date()),
          },
        ],
        {
          refreshLeaseOwner: this.owner,
          refreshLeaseExpiresAt: new Date(Date.now() + this.config.app.qbo.refreshLeaseDurationMs),
        },
      );
      if (!acquired.affected) {
        await new Promise((resolve) => setTimeout(resolve, this.config.app.qbo.refreshLeaseRetryDelayMs));
        continue;
      }
      try {
        const refreshed = await this.refresh(this.cipher.decrypt(connection.encryptedRefreshToken));
        const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
        const saved = await this.connections.update(
          { realmId, tokenVersion: connection.tokenVersion, refreshLeaseOwner: this.owner },
          {
            encryptedAccessToken: this.cipher.encrypt(refreshed.access_token),
            encryptedRefreshToken: this.cipher.encrypt(refreshed.refresh_token),
            accessTokenExpiresAt: expiresAt,
            refreshTokenExpiresAt: refreshed.x_refresh_token_expires_in
              ? new Date(Date.now() + refreshed.x_refresh_token_expires_in * 1000)
              : null,
            tokenVersion: connection.tokenVersion + 1,
            refreshLeaseOwner: null,
            refreshLeaseExpiresAt: null,
          },
        );
        if (!saved.affected) continue;
        this.cache.set(realmId, { accessToken: refreshed.access_token, expiresAt: expiresAt.getTime() });
        return refreshed.access_token;
      } catch (error) {
        if (error instanceof ExternalServiceError && error.statusCode === 400) {
          await this.connections.update(
            { realmId, refreshLeaseOwner: this.owner },
            { status: 'REAUTH_REQUIRED', refreshLeaseOwner: null, refreshLeaseExpiresAt: null },
          );
          throw new DependencyUnavailableError('DEPENDENCY_UNAVAILABLE');
        }
        await this.connections.update(
          { realmId, refreshLeaseOwner: this.owner },
          { refreshLeaseOwner: null, refreshLeaseExpiresAt: null },
        );
        throw error;
      }
    }
    throw new DependencyUnavailableError('DEPENDENCY_UNAVAILABLE');
  }

  private refresh(refreshToken: string): Promise<TokenResponse> {
    const { clientId, tokenPath } = this.config.qbo;
    const { clientSecret } = this.config.secrets.qbo;
    return this.http.oauth<TokenResponse>(tokenPath, {
      method: 'POST',
      headers: {
        Authorization: basicAuthorization(clientId, clientSecret),
        'content-type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
  }
}
