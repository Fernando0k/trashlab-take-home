import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/database-options';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QboIntegrationModule } from './modules/qbo-integration/qbo-integration.module';
import { SyncOrchestratorModule } from './modules/sync-orchestrator/sync-orchestrator.module';
import { AppConfig } from './shared/config/app-config.service';
import { ConfigurationModule } from './shared/config/configuration.module';
import { HealthModule } from './shared/health/health.module';
import { HttpModule } from './shared/http/http.module';

@Module({
  imports: [
    ConfigurationModule,
    HttpModule,
    HealthModule,
    TypeOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        ...databaseOptions(config.database, config.secrets.database),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    ScheduleModule.forRoot(),
    InvoicingModule,
    PaymentsModule,
    QboIntegrationModule,
    SyncOrchestratorModule,
  ],
})
export class AppModule {}
