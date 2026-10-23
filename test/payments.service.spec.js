const { PaymentsService } = require('../dist/modules/payments/application/payments.service');
const {
  InternalPaymentEntity,
} = require('../dist/modules/payments/infrastructure/persistence/internal-payment.entity');
describe('PaymentsService', () => {
  const payment = {
    qboPaymentId: 'payment-1',
    qboSyncToken: '3',
    customerRef: 'customer-1',
    paymentDate: '2026-10-17',
    amount: '30.00',
    unappliedAmount: '5.00',
    paymentMethodRef: 'method-1',
    referenceNumber: 'receipt-1',
    allocations: [
      { qboInvoiceId: 'invoice-1', amount: '20.00' },
      { qboInvoiceId: 'invoice-2', amount: '5.00' },
    ],
  };

  it('replaces QBO payment allocations atomically when the payment changes', async () => {
    const paymentRepository = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'internal-payment-1', status: 'ACTIVE' }),
      create: vi.fn((value) => value),
      save: vi.fn().mockResolvedValue({ id: 'internal-payment-1' }),
    };
    const allocationRepository = {
      delete: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: vi.fn((entity) => (entity === InternalPaymentEntity ? paymentRepository : allocationRepository)),
    };

    const invoiceIds = await new PaymentsService().upsertFromQboInTransaction(manager, payment);

    expect(paymentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ qboPaymentId: 'payment-1', status: 'ACTIVE' }),
    );
    expect(allocationRepository.delete).toHaveBeenCalledWith({ paymentId: 'internal-payment-1' });
    expect(allocationRepository.insert).toHaveBeenCalledWith([
      { paymentId: 'internal-payment-1', qboInvoiceId: 'invoice-1', amount: '20.00' },
      { paymentId: 'internal-payment-1', qboInvoiceId: 'invoice-2', amount: '5.00' },
    ]);
    expect(invoiceIds).toEqual(['invoice-1', 'invoice-2']);
  });

  it('does not rewrite allocations when a QBO Payment SyncToken is already stored', async () => {
    const paymentRepository = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'internal-payment-1', qboSyncToken: '3', status: 'ACTIVE' }),
    };
    const allocationRepository = {
      findBy: vi.fn().mockResolvedValue([{ qboInvoiceId: 'invoice-1' }]),
      delete: vi.fn(),
      insert: vi.fn(),
    };
    const manager = {
      getRepository: vi.fn((entity) => (entity === InternalPaymentEntity ? paymentRepository : allocationRepository)),
    };

    await expect(new PaymentsService().upsertFromQboInTransaction(manager, payment)).resolves.toEqual(['invoice-1']);
    expect(allocationRepository.delete).not.toHaveBeenCalled();
    expect(allocationRepository.insert).not.toHaveBeenCalled();
  });

  it('keeps allocations as history while marking a deleted QBO payment as deleted', async () => {
    const paymentRepository = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'internal-payment-1', status: 'ACTIVE' }),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const allocationRepository = {
      findBy: vi.fn().mockResolvedValue([{ qboInvoiceId: 'invoice-1' }, { qboInvoiceId: 'invoice-2' }]),
    };
    const manager = {
      getRepository: vi.fn((entity) => (entity === InternalPaymentEntity ? paymentRepository : allocationRepository)),
    };

    await expect(new PaymentsService().markDeletedFromQboInTransaction(manager, 'payment-1')).resolves.toEqual([
      'invoice-1',
      'invoice-2',
    ]);
    expect(paymentRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'DELETED' }));
  });
});
