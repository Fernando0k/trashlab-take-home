import { PaymentSnapshot } from '../../payments/domain/payment';

export type QboPayment = {
  Id: string;
  SyncToken: string;
  CustomerRef: { value: string };
  TxnDate: string;
  TotalAmt: number;
  UnappliedAmt?: number;
  PaymentMethodRef?: { value: string };
  PaymentRefNum?: string;
  Line?: Array<{ Amount?: number; LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }> }>;
};

export function toPaymentSnapshot(payment: QboPayment): PaymentSnapshot {
  const allocations = new Map<string, number>();
  for (const line of payment.Line ?? []) {
    for (const linkedTransaction of line.LinkedTxn ?? []) {
      if (linkedTransaction.TxnType === 'Invoice' && linkedTransaction.TxnId) {
        allocations.set(linkedTransaction.TxnId, (allocations.get(linkedTransaction.TxnId) ?? 0) + (line.Amount ?? 0));
      }
    }
  }
  return {
    qboPaymentId: payment.Id,
    qboSyncToken: payment.SyncToken,
    customerRef: payment.CustomerRef.value,
    paymentDate: payment.TxnDate,
    amount: String(payment.TotalAmt),
    unappliedAmount: String(payment.UnappliedAmt ?? 0),
    paymentMethodRef: payment.PaymentMethodRef?.value,
    referenceNumber: payment.PaymentRefNum,
    allocations: [...allocations].map(([qboInvoiceId, amount]) => ({ qboInvoiceId, amount: String(amount) })),
  };
}
