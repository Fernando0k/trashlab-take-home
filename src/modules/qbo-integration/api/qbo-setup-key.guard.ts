import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfig } from '../../../shared/config/app-config.service';
import { matchesSecret } from '../../../shared/auth/secret-match';

/** Protects the human-initiated QBO OAuth bootstrap endpoint. */
@Injectable()
export class QboSetupKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const supplied = context.switchToHttp().getRequest().headers['x-qbo-setup-key'];
    if (typeof supplied !== 'string' || !matchesSecret(supplied, this.config.secrets.auth.qboSetupApiKey)) {
      throw new UnauthorizedException('Invalid QBO setup key');
    }
    return true;
  }
}
