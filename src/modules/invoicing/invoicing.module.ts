import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalInvoiceEntity } from './infrastructure/persistence/internal-invoice.entity';
import { SyncOrchestratorModule } from '../sync-orchestrator/sync-orchestrator.module';
import { InvoicesController } from './api/invoices.controller';
import { InvoicesService } from './application/invoices.service';
import { INTERNAL_INVOICE_PORT } from './domain/internal-invoice.port';
import { InternalApiKeyGuard } from '../../shared/auth/internal-api-key.guard';
@Module({
  imports: [TypeOrmModule.forFeature([InternalInvoiceEntity]), forwardRef(() => SyncOrchestratorModule)],
  controllers: [InvoicesController],
  providers: [InvoicesService, InternalApiKeyGuard, { provide: INTERNAL_INVOICE_PORT, useExisting: InvoicesService }],
  exports: [INTERNAL_INVOICE_PORT],
})
export class InvoicingModule {}
