import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationConfig, DatabaseConfig, QuickBooksConfig, SecretsConfig } from './configuration';

/** The sole typed configuration boundary for application providers. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  get app(): ApplicationConfig {
    return this.config.getOrThrow<ApplicationConfig>('app');
  }

  get database(): DatabaseConfig {
    return this.config.getOrThrow<DatabaseConfig>('database');
  }

  get qbo(): QuickBooksConfig {
    return this.config.getOrThrow<QuickBooksConfig>('qbo');
  }

  get secrets(): SecretsConfig {
    return this.config.getOrThrow<SecretsConfig>('secrets');
  }
}
