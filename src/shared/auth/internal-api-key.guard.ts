import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AppConfig } from '../config/app-config.service';
import { matchesSecret } from './secret-match';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.headers['x-internal-api-key'];
    if (!matchesSecret(typeof key === 'string' ? key : undefined, this.config.secrets.auth.internalApiKey)) {
      throw new UnauthorizedException('Invalid internal API key', { errorCode: 'INVALID_INTERNAL_API_KEY' });
    }
    return true;
  }
}
