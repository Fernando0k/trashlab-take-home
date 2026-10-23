import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { LessThan, Repository } from 'typeorm';
import { AppConfig } from '../../../shared/config/app-config.service';
import { QboRateLimitBucketEntity } from '../infrastructure/persistence/qbo-rate-limit-bucket.entity';

const OAUTH_START_SCOPE = 'qbo-oauth-start';

/**
 * A Postgres-backed limit shared by every pod. This protects the privileged
 * OAuth bootstrap endpoint without applying delivery-hostile limits to QBO webhooks.
 */
@Injectable()
export class QboSetupRateLimitGuard implements CanActivate {
  constructor(
    private readonly config: AppConfig,
    @InjectRepository(QboRateLimitBucketEntity)
    private readonly buckets: Repository<QboRateLimitBucketEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const setupKey = context.switchToHttp().getRequest().headers['x-qbo-setup-key'];
    if (typeof setupKey !== 'string') return false;

    const windowMs = this.config.app.qbo.oauthStartRateLimitWindowMs;
    await this.buckets.delete({ windowStartedAt: LessThan(new Date(Date.now() - windowMs)) });
    const windowStartedAt = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    const subjectHash = createHash('sha256').update(setupKey).digest('hex');
    await this.buckets
      .createQueryBuilder()
      .insert()
      .values({ scope: OAUTH_START_SCOPE, subjectHash, windowStartedAt, hits: 0 })
      .orIgnore()
      .execute();
    const incremented = await this.buckets.increment(
      {
        scope: OAUTH_START_SCOPE,
        subjectHash,
        windowStartedAt,
        hits: LessThan(this.config.app.qbo.oauthStartRateLimit),
      },
      'hits',
      1,
    );
    if (!incremented.affected) {
      throw new HttpException('Too many QuickBooks connection attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
