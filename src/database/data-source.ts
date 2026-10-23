import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InternalInvoiceEntity } from '../modules/invoicing/infrastructure/persistence/internal-invoice.entity';
import { InternalPaymentEntity } from '../modules/payments/infrastructure/persistence/internal-payment.entity';
import { PaymentAllocationEntity } from '../modules/payments/infrastructure/persistence/payment-allocation.entity';
import { InvoiceLinkEntity } from '../modules/sync-orchestrator/infrastructure/persistence/invoice-link.entity';
import { SyncAuditEntity } from '../modules/sync-orchestrator/infrastructure/persistence/sync-audit.entity';
import { SyncConflictEntity } from '../modules/sync-orchestrator/infrastructure/persistence/sync-conflict.entity';
import { SyncJobEntity } from '../modules/sync-orchestrator/infrastructure/persistence/sync-job.entity';
import { SyncEntityLeaseEntity } from '../modules/sync-orchestrator/infrastructure/persistence/sync-entity-lease.entity';
import { QboConnectionEntity } from '../modules/qbo-integration/infrastructure/persistence/qbo-connection.entity';
import { QboOauthStateEntity } from '../modules/qbo-integration/infrastructure/persistence/qbo-oauth-state.entity';
import { QboRateLimitBucketEntity } from '../modules/qbo-integration/infrastructure/persistence/qbo-rate-limit-bucket.entity';
import { databaseOptions } from './database-options';
import { databaseConfiguration, databaseSecretsConfiguration } from '../shared/config/configuration';
export default new DataSource({
  ...databaseOptions(databaseConfiguration(), databaseSecretsConfiguration()),
  entities: [
    InternalInvoiceEntity,
    InternalPaymentEntity,
    PaymentAllocationEntity,
    InvoiceLinkEntity,
    SyncJobEntity,
    SyncEntityLeaseEntity,
    SyncConflictEntity,
    SyncAuditEntity,
    QboConnectionEntity,
    QboOauthStateEntity,
    QboRateLimitBucketEntity,
  ],
  migrations: [__dirname + '/migrations/*{.js,.ts}'],
});
