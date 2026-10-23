import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { InternalPaymentPort } from '../domain/internal-payment.port';
import { PAYMENT_STATUS, PaymentSnapshot } from '../domain/payment';
import { InternalPaymentEntity } from '../infrastructure/persistence/internal-payment.entity';
import { PaymentAllocationEntity } from '../infrastructure/persistence/payment-allocation.entity';

@Injectable()
export class PaymentsService implements InternalPaymentPort {
  async upsertFromQboInTransaction(manager: EntityManager, payment: PaymentSnapshot): Promise<string[]> {
    const payments = manager.getRepository(InternalPaymentEntity);
    const allocations = manager.getRepository(PaymentAllocationEntity);
    const existing = await payments.findOneBy({ qboPaymentId: payment.qboPaymentId });
    if (existing?.qboSyncToken === payment.qboSyncToken && existing.status === PAYMENT_STATUS.ACTIVE) {
      return this.allocationInvoiceIds(manager, existing.id);
    }
    const saved = await payments.save(
      payments.create({
        ...existing,
        qboPaymentId: payment.qboPaymentId,
        qboSyncToken: payment.qboSyncToken,
        customerRef: payment.customerRef,
        paymentDate: payment.paymentDate,
        amount: payment.amount,
        unappliedAmount: payment.unappliedAmount,
        paymentMethodRef: payment.paymentMethodRef,
        referenceNumber: payment.referenceNumber,
        status: PAYMENT_STATUS.ACTIVE,
      }),
    );

    await allocations.delete({ paymentId: saved.id });
    if (payment.allocations.length > 0) {
      await allocations.insert(
        payment.allocations.map((allocation) => ({
          paymentId: saved.id,
          qboInvoiceId: allocation.qboInvoiceId,
          amount: allocation.amount,
        })),
      );
    }
    return payment.allocations.map((allocation) => allocation.qboInvoiceId);
  }

  async markDeletedFromQboInTransaction(manager: EntityManager, qboPaymentId: string): Promise<string[]> {
    const payments = manager.getRepository(InternalPaymentEntity);
    const payment = await payments.findOneBy({ qboPaymentId });
    if (!payment) return [];

    const invoiceIds = await this.allocationInvoiceIds(manager, payment.id);
    if (payment.status !== PAYMENT_STATUS.DELETED) {
      payment.status = PAYMENT_STATUS.DELETED;
      await payments.save(payment);
    }
    return invoiceIds;
  }

  private async allocationInvoiceIds(manager: EntityManager, paymentId: string): Promise<string[]> {
    const allocations = await manager.getRepository(PaymentAllocationEntity).findBy({ paymentId });
    return allocations.map((allocation) => allocation.qboInvoiceId);
  }
}
