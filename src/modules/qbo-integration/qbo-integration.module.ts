import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncOrchestratorModule } from '../sync-orchestrator/sync-orchestrator.module';
import { QboOauthController } from './api/qbo-oauth.controller';
import { QboWebhookController } from './api/qbo-webhook.controller';
import { QboAccountingClient } from './application/qbo-accounting.client';
import { QBO_INVOICE_CLIENT } from './domain/qbo-invoice.port';
import { QBO_PAYMENT_CLIENT } from './domain/qbo-payment.port';
import { QboHttpClient } from './infrastructure/qbo-http.client';
import { QboWebhookGuard } from './api/qbo-webhook.guard';
import { QboSetupKeyGuard } from './api/qbo-setup-key.guard';
import { QboConnectionService } from './application/qbo-connection.service';
import { QboTokenCipher } from './infrastructure/qbo-token-cipher';
import { QboConnectionEntity } from './infrastructure/persistence/qbo-connection.entity';
import { QboOauthStateEntity } from './infrastructure/persistence/qbo-oauth-state.entity';
import { QboRateLimitBucketEntity } from './infrastructure/persistence/qbo-rate-limit-bucket.entity';
import { QboOauthStateService } from './application/qbo-oauth-state.service';
import { QboSetupRateLimitGuard } from './api/qbo-setup-rate-limit.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([QboConnectionEntity, QboOauthStateEntity, QboRateLimitBucketEntity]),
    forwardRef(() => SyncOrchestratorModule),
  ],
  controllers: [QboWebhookController, QboOauthController],
  providers: [
    QboHttpClient,
    QboAccountingClient,
    QboWebhookGuard,
    QboSetupKeyGuard,
    QboSetupRateLimitGuard,
    QboConnectionService,
    QboOauthStateService,
    QboTokenCipher,
    { provide: QBO_INVOICE_CLIENT, useExisting: QboAccountingClient },
    { provide: QBO_PAYMENT_CLIENT, useExisting: QboAccountingClient },
  ],
  exports: [QBO_INVOICE_CLIENT, QBO_PAYMENT_CLIENT, QboConnectionService],
})
export class QboIntegrationModule {}
