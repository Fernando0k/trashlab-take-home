import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceLinkEntity } from './infrastructure/persistence/invoice-link.entity';
import { SyncAuditEntity } from './infrastructure/persistence/sync-audit.entity';
import { SyncConflictEntity } from './infrastructure/persistence/sync-conflict.entity';
import { SyncJobEntity } from './infrastructure/persistence/sync-job.entity';
import { SyncEntityLeaseEntity } from './infrastructure/persistence/sync-entity-lease.entity';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { QboIntegrationModule } from '../qbo-integration/qbo-integration.module';
import { PaymentsModule } from '../payments/payments.module';
import { SyncWorker } from './application/sync.worker';
import { SYNC_JOB_PORT } from './domain/sync-job.port';
import { SyncRepository } from './infrastructure/sync.repository';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvoiceLinkEntity,
      SyncJobEntity,
      SyncEntityLeaseEntity,
      SyncConflictEntity,
      SyncAuditEntity,
    ]),
    forwardRef(() => InvoicingModule),
    forwardRef(() => QboIntegrationModule),
    PaymentsModule,
  ],
  providers: [SyncRepository, SyncWorker, { provide: SYNC_JOB_PORT, useExisting: SyncRepository }],
  exports: [SYNC_JOB_PORT],
})
export class SyncOrchestratorModule {}
