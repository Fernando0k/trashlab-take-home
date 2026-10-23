import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Request } from 'express';
import { matchesSecret } from '../../../shared/auth/secret-match';
import { AppConfig } from '../../../shared/config/app-config.service';

@Injectable()
export class QboWebhookGuard implements CanActivate {
  private readonly logger = new Logger(QboWebhookGuard.name);

  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const rawBody = request.rawBody;
    const signature = request.headers['intuit-signature'];
    const received = typeof signature === 'string' ? signature : undefined;
    if (!rawBody) this.reject('missing_raw_body');
    if (!received) this.reject('missing_signature');

    const expected = createHmac('sha256', this.config.secrets.qbo.webhookVerifierToken)
      .update(rawBody)
      .digest('base64');
    if (!matchesSecret(received, expected)) {
      this.reject('signature_mismatch');
    }
    return true;
  }

  private reject(reason: 'missing_raw_body' | 'missing_signature' | 'signature_mismatch'): never {
    this.logger.warn({ event: 'qbo_webhook_authentication_failed', reason });
    throw new UnauthorizedException();
  }
}
