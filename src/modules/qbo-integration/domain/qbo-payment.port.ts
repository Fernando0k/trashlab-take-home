import { PaymentSnapshot } from '../../payments/domain/payment';

export const QBO_PAYMENT_CLIENT = Symbol('QBO_PAYMENT_CLIENT');

export interface QboPaymentClient {
  getPayment(id: string): Promise<PaymentSnapshot>;
}
