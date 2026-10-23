import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Redirect,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AppConfig } from '../../../shared/config/app-config.service';
import { basicAuthorization } from '../../../shared/auth/basic-authorization';
import { QboHttpClient } from '../infrastructure/qbo-http.client';
import { QboConnectionService } from '../application/qbo-connection.service';
import { QboSetupKeyGuard } from './qbo-setup-key.guard';
import { QboSetupRateLimitGuard } from './qbo-setup-rate-limit.guard';
import { QboOauthStateService } from '../application/qbo-oauth-state.service';
import { qboAuthorizationUrl } from '../infrastructure/qbo-urls';
import { ApiExcludeEndpoint, ApiOperation, ApiSecurity, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
@Controller('qbo/oauth')
@ApiTags('QuickBooks connection')
export class QboOauthController {
  private readonly logger = new Logger(QboOauthController.name);

  constructor(
    private readonly config: AppConfig,
    private readonly http: QboHttpClient,
    private readonly connections: QboConnectionService,
    private readonly states: QboOauthStateService,
  ) {}
  @Get('start')
  @Redirect()
  @UseGuards(QboSetupKeyGuard, QboSetupRateLimitGuard)
  @ApiOperation({ summary: 'Start the protected QuickBooks OAuth connection flow' })
  @ApiSecurity('qboSetupKey')
  @ApiTooManyRequestsResponse({ description: 'Too many connection attempts' })
  async start(): Promise<{ url: string }> {
    const { authorizationEndpoint, accountingScope, clientId: client, redirectUri: redirect } = this.config.qbo;
    const state = await this.states.issue();
    this.logger.log({ event: 'qbo_oauth_authorization_started' });
    return {
      url: qboAuthorizationUrl({
        authorizationEndpoint,
        accountingScope,
        clientId: client,
        redirectUri: redirect,
        state,
      }),
    };
  }
  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code?: string,
    @Query('realmId') realmId?: string,
    @Query('state') state?: string,
  ): Promise<{ realmId: string; connected: true }> {
    if (!code || !realmId) throw new ServiceUnavailableException('Missing OAuth code or realm ID');
    if (!state || !(await this.states.consume(state))) throw new BadRequestException('Invalid or expired OAuth state');
    const { clientId: id, redirectUri: redirect, tokenPath } = this.config.qbo;
    const { clientSecret: secret } = this.config.secrets.qbo;
    const tokens = await this.http.oauth<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      x_refresh_token_expires_in?: number;
    }>(tokenPath, {
      method: 'POST',
      headers: {
        Authorization: basicAuthorization(id, secret),
        'content-type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect }).toString(),
    });
    await this.connections.saveAuthorization(realmId, tokens);
    this.logger.log({ event: 'qbo_oauth_connection_succeeded' });
    return { realmId, connected: true };
  }
}
