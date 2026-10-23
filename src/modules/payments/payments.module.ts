import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './application/payments.service';
import { INTERNAL_PAYMENT_PORT } from './domain/internal-payment.port';
import { InternalPaymentEntity } from './infrastructure/persistence/internal-payment.entity';
import { PaymentAllocationEntity } from './infrastructure/persistence/payment-allocation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InternalPaymentEntity, PaymentAllocationEntity])],
  providers: [PaymentsService, { provide: INTERNAL_PAYMENT_PORT, useExisting: PaymentsService }],
  exports: [INTERNAL_PAYMENT_PORT],
})
export class PaymentsModule {}
