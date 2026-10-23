export const PAYMENT_STATUSES = ['ACTIVE', 'DELETED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS = {
  ACTIVE: 'ACTIVE',
  DELETED: 'DELETED',
} as const satisfies Record<string, PaymentStatus>;

export type PaymentAllocation = {
  qboInvoiceId: string;
  amount: string;
};

/** A QBO customer payment and its invoice allocations. */
export type PaymentSnapshot = {
  qboPaymentId: string;
  qboSyncToken: string;
  customerRef: string;
  paymentDate: string;
  amount: string;
  unappliedAmount: string;
  paymentMethodRef?: string;
  referenceNumber?: string;
  allocations: PaymentAllocation[];
};
