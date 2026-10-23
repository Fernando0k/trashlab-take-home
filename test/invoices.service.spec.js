const { InvoicesService } = require('../dist/modules/invoicing/application/invoices.service');

describe('InvoicesService', () => {
  it('writes an invoice and its idempotent sync job in the same transaction', async () => {
    const manager = {
      create: vi.fn((_, value) => value),
      save: vi.fn(async (_, value) => ({ ...value, id: 'invoice-1', version: 1 })),
    };
    const db = { transaction: vi.fn((work) => work(manager)) };
    const sync = { enqueueInTransaction: vi.fn() };
    const service = new InvoicesService({}, sync, db);

    await service.create({
      number: 'INV-1',
      customerRef: 'customer-1',
      issueDate: '2026-10-16',
      total: '10.00',
      lines: [{ description: 'Work', amount: '10.00', qboItemRef: 'item-1' }],
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(sync.enqueueInTransaction).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ dedupeKey: 'internal:invoice:invoice-1:v1', operation: 'upsert' }),
    );
  });

  it('returns a safe conflict when a concurrent write uses an existing invoice number', async () => {
    const db = { transaction: vi.fn().mockRejectedValue({ code: '23505', detail: 'customer@example.test' }) };
    const service = new InvoicesService({}, { enqueueInTransaction: vi.fn() }, db);

    await expect(
      service.create({
        number: 'INV-1',
        customerRef: 'customer-1',
        issueDate: '2026-10-16',
        total: '10.00',
        lines: [{ description: 'Work', amount: '10.00', qboItemRef: 'item-1' }],
      }),
    ).rejects.toMatchObject({ status: 409, response: { errorCode: 'INVOICE_NUMBER_ALREADY_EXISTS' } });
  });

  it('preserves the paid amount when an invoice total changes', async () => {
    const invoice = {
      id: 'invoice-1',
      status: 'OPEN',
      version: 1,
      total: '10.00',
      balance: '7.00',
      lines: [],
    };
    const manager = {
      findOneBy: vi.fn().mockResolvedValue(invoice),
      save: vi.fn(async (_, value) => value),
    };
    const db = { transaction: vi.fn((work) => work(manager)) };
    const sync = { enqueueInTransaction: vi.fn() };
    const service = new InvoicesService({}, sync, db);

    await service.update('invoice-1', { total: '12.00' });

    expect(manager.save).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ total: '12.00', balance: '9.00', version: 2 }),
    );
  });
});
