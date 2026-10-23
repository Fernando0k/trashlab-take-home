const { toPaymentSnapshot } = require('../dist/modules/qbo-integration/application/qbo-payment.mapper');

describe('QBO payment mapper', () => {
  it('maps payment data and aggregates allocations for each linked QBO Invoice', () => {
    expect(
      toPaymentSnapshot({
        Id: 'payment-1',
        SyncToken: '3',
        CustomerRef: { value: 'customer-1' },
        TxnDate: '2026-10-17',
        TotalAmt: 30,
        UnappliedAmt: 5,
        PaymentMethodRef: { value: 'method-1' },
        PaymentRefNum: 'receipt-1',
        Line: [
          { Amount: 10, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'invoice-1' }] },
          { Amount: 15, LinkedTxn: [{ TxnType: 'CreditMemo', TxnId: 'credit-1' }] },
          {
            Amount: 15,
            LinkedTxn: [
              { TxnType: 'Invoice', TxnId: 'invoice-1' },
              { TxnType: 'Invoice', TxnId: 'invoice-2' },
            ],
          },
        ],
      }),
    ).toEqual({
      qboPaymentId: 'payment-1',
      qboSyncToken: '3',
      customerRef: 'customer-1',
      paymentDate: '2026-10-17',
      amount: '30',
      unappliedAmount: '5',
      paymentMethodRef: 'method-1',
      referenceNumber: 'receipt-1',
      allocations: [
        { qboInvoiceId: 'invoice-1', amount: '25' },
        { qboInvoiceId: 'invoice-2', amount: '15' },
      ],
    });
  });
});
