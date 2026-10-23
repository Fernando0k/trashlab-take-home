import { EntityManager } from 'typeorm';
import { PaymentSnapshot } from './payment';

export const INTERNAL_PAYMENT_PORT = Symbol('INTERNAL_PAYMENT_PORT');

export interface InternalPaymentPort {
  upsertFromQboInTransaction(manager: EntityManager, payment: PaymentSnapshot): Promise<string[]>;
  markDeletedFromQboInTransaction(manager: EntityManager, qboPaymentId: string): Promise<string[]>;
}
