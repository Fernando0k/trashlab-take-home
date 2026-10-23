import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { AppConfig } from '../../../shared/config/app-config.service';
import { QboOauthStateEntity } from '../infrastructure/persistence/qbo-oauth-state.entity';

@Injectable()
export class QboOauthStateService {
  constructor(
    private readonly config: AppConfig,
    @InjectRepository(QboOauthStateEntity) private readonly states: Repository<QboOauthStateEntity>,
  ) {}

  async issue(): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.states.delete({ expiresAt: LessThan(now) });
    await this.states.insert({
      stateHash: this.hash(state),
      expiresAt: new Date(now.getTime() + this.config.app.qbo.oauthStateTtlMs),
    });
    return state;
  }

  /** Deletes and validates in one statement, so a state cannot be replayed. */
  async consume(state: string): Promise<boolean> {
    const deleted = await this.states.delete({
      stateHash: this.hash(state),
      expiresAt: MoreThan(new Date()),
    });
    return Boolean(deleted.affected);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
