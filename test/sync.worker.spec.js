const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { SchedulerRegistry } = require('@nestjs/schedule');
const { INTERNAL_INVOICE_PORT } = require('../dist/modules/invoicing/domain/internal-invoice.port');
const { INTERNAL_PAYMENT_PORT } = require('../dist/modules/payments/domain/internal-payment.port');
const { QBO_INVOICE_CLIENT } = require('../dist/modules/qbo-integration/domain/qbo-invoice.port');
const { QBO_PAYMENT_CLIENT } = require('../dist/modules/qbo-integration/domain/qbo-payment.port');
const { SyncRepository } = require('../dist/modules/sync-orchestrator/infrastructure/sync.repository');
const { SyncWorker } = require('../dist/modules/sync-orchestrator/application/sync.worker');
const { AppConfig } = require('../dist/shared/config/app-config.service');

const snap = (overrides = {}) => ({
  source: 'internal',
  externalId: 'internal-1',
  number: 'INV-1',
  customerRef: 'customer-1',
  issueDate: '2026-01-01',
  currency: 'USD',
  total: '10.00',
  balance: '10.00',
  status: 'OPEN',
  lines: [{ description: 'work', amount: '10.00', qboItemRef: 'item-1' }],
  version: '1',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('SyncWorker', () => {
  const sync = {
    claim: vi.fn(),
    enqueue: vi.fn(),
    enqueueInTransaction: vi.fn(),
    findLinkByInternal: vi.fn(),
    findLinkByQbo: vi.fn(),
    saveLink: vi.fn(),
    completeWithLink: vi.fn(),
    completeWithLinkInTransaction: vi.fn(),
    done: vi.fn(),
    doneInTransaction: vi.fn(),
    retry: vi.fn(),
    fail: vi.fn(),
    conflict: vi.fn(),
    acquireEntityLease: vi.fn(),
    releaseEntityLease: vi.fn(),
    defer: vi.fn(),
    waitForDependency: vi.fn(),
  };
  const internal = {
    getSnapshot: vi.fn(),
    findSnapshotByNumber: vi.fn(),
    upsertFromQboInTransaction: vi.fn(),
    markDeletedFromQboInTransaction: vi.fn(),
  };
  const qbo = {
    getInvoice: vi.fn(),
    findInvoiceByDocNumber: vi.fn(),
    createInvoice: vi.fn(),
    updateInvoice: vi.fn(),
    voidInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
    getPayment: vi.fn(),
  };
  const payments = {
    upsertFromQboInTransaction: vi.fn(),
    markDeletedFromQboInTransaction: vi.fn(),
  };
  const db = { transaction: vi.fn() };
  const config = { app: { sync: { pollIntervalMs: 2_000 } } };
  const scheduler = { addInterval: vi.fn(), deleteInterval: vi.fn(), doesExist: vi.fn() };
  let worker;
  beforeEach(async () => {
    vi.clearAllMocks();
    sync.acquireEntityLease.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        SyncWorker,
        { provide: SyncRepository, useValue: sync },
        { provide: DataSource, useValue: db },
        { provide: AppConfig, useValue: config },
        { provide: SchedulerRegistry, useValue: scheduler },
        { provide: INTERNAL_INVOICE_PORT, useValue: internal },
        { provide: INTERNAL_PAYMENT_PORT, useValue: payments },
        { provide: QBO_INVOICE_CLIENT, useValue: qbo },
        { provide: QBO_PAYMENT_CLIENT, useValue: qbo },
      ],
    }).compile();
    worker = module.get(SyncWorker);
  });

  it('stops its poll interval and logs shutdown', () => {
    scheduler.doesExist.mockReturnValue(true);
    const log = vi.spyOn(worker.logger, 'log');

    worker.onApplicationShutdown();

    expect(scheduler.deleteInterval).toHaveBeenCalledWith('sync-outbox-poll');
    expect(log).toHaveBeenCalledWith({ event: 'sync_worker_shutdown', intervalRemoved: true });
  });

  it('records a conflict and writes neither side for concurrent edits', async () => {
    const base = snap();
    const internalNow = snap({ total: '15.00', version: '2' });
    const qboNow = snap({ source: 'qbo', externalId: 'qbo-1', total: '20.00', version: '5' });
    const job = { id: 'job', source: 'internal', entityType: 'invoice', entityId: 'internal-1', operation: 'upsert' };
    sync.claim.mockResolvedValue(job);
    internal.getSnapshot.mockResolvedValue(internalNow);
    sync.findLinkByInternal.mockResolvedValue({
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      qboSyncToken: '1',
      lastInternalSnapshot: base,
      lastQboSnapshot: { ...base, source: 'qbo', externalId: 'qbo-1' },
    });
    qbo.getInvoice.mockResolvedValue(qboNow);
    await worker.tick();
    expect(sync.conflict).toHaveBeenCalledWith(job, expect.anything(), internalNow, qboNow);
    expect(qbo.updateInvoice).not.toHaveBeenCalled();
    expect(sync.done).not.toHaveBeenCalled();
  });
  it('persists a retry when QBO times out', async () => {
    const job = { id: 'job', source: 'internal', entityType: 'invoice', entityId: 'internal-1', operation: 'upsert' };
    sync.claim.mockResolvedValue(job);
    internal.getSnapshot.mockResolvedValue(snap());
    sync.findLinkByInternal.mockResolvedValue(null);
    qbo.findInvoiceByDocNumber.mockRejectedValue(new Error('ETIMEDOUT'));
    await worker.tick();
    expect(sync.retry).toHaveBeenCalledWith(job, expect.any(Error));
  });
  it('records a permanent failure instead of retrying a rejected QBO write', async () => {
    const job = { id: 'job', source: 'internal', entityType: 'invoice', entityId: 'internal-1', operation: 'upsert' };
    sync.claim.mockResolvedValue(job);
    internal.getSnapshot.mockResolvedValue(snap());
    sync.findLinkByInternal.mockResolvedValue(null);
    qbo.findInvoiceByDocNumber.mockRejectedValue(
      new (require('../dist/shared/errors/application-error').ExternalServiceError)('Rejected', {
        code: 'EXTERNAL_CLIENT_ERROR',
        retryable: false,
        statusCode: 400,
      }),
    );
    await worker.tick();
    expect(sync.fail).toHaveBeenCalledWith(job, expect.objectContaining({ code: 'EXTERNAL_CLIENT_ERROR' }));
    expect(sync.retry).not.toHaveBeenCalled();
  });

  it('persists a QBO payment and queues idempotent linked-invoice reconciliations in one transaction', async () => {
    const job = { id: 'payment-job', source: 'qbo', entityType: 'payment', entityId: 'payment-1', operation: 'upsert' };
    const payment = {
      qboPaymentId: 'payment-1',
      qboSyncToken: '3',
      customerRef: 'customer-1',
      paymentDate: '2026-10-17',
      amount: '30.00',
      unappliedAmount: '0.00',
      allocations: [],
    };
    sync.claim.mockResolvedValue(job);
    qbo.getPayment.mockResolvedValue(payment);
    payments.upsertFromQboInTransaction.mockResolvedValue(['invoice-1', 'invoice-2']);
    db.transaction.mockImplementation(async (callback) => callback({}));

    await worker.tick();

    expect(payments.upsertFromQboInTransaction).toHaveBeenCalledWith(expect.anything(), payment);
    expect(sync.enqueueInTransaction).toHaveBeenNthCalledWith(1, expect.anything(), {
      dedupeKey: 'qbo:payment:payment-1:v3:invoice:invoice-1',
      source: 'qbo',
      entityType: 'invoice',
      entityId: 'invoice-1',
      operation: 'upsert',
      payload: { paymentId: 'payment-1', paymentVersion: '3', sourceJobId: 'payment-job' },
    });
    expect(sync.enqueueInTransaction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ entityId: 'invoice-2' }),
    );
    expect(sync.doneInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      job,
      expect.objectContaining({ action: 'payment_status_reconciliation_queued', invoiceCount: 2 }),
    );
  });

  it('retains a deleted payment and reconciles its previously allocated invoices', async () => {
    const job = {
      id: 'payment-delete',
      source: 'qbo',
      entityType: 'payment',
      entityId: 'payment-1',
      operation: 'delete',
    };
    sync.claim.mockResolvedValue(job);
    payments.markDeletedFromQboInTransaction.mockResolvedValue(['invoice-1']);
    db.transaction.mockImplementation(async (callback) => callback({}));

    await worker.tick();

    expect(qbo.getPayment).not.toHaveBeenCalled();
    expect(payments.markDeletedFromQboInTransaction).toHaveBeenCalledWith(expect.anything(), 'payment-1');
    expect(sync.enqueueInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dedupeKey: 'qbo:payment:payment-1:vdeleted:invoice:invoice-1',
        entityId: 'invoice-1',
      }),
    );
  });

  it('waits for a QBO connection without consuming the retry budget', async () => {
    const { DependencyUnavailableError } = require('../dist/shared/errors/application-error');
    const job = { id: 'job', source: 'internal', entityType: 'invoice', entityId: 'internal-1', operation: 'upsert' };
    sync.claim.mockResolvedValue(job);
    internal.getSnapshot.mockResolvedValue(snap());
    sync.findLinkByInternal.mockResolvedValue(null);
    qbo.findInvoiceByDocNumber.mockRejectedValue(new DependencyUnavailableError('DEPENDENCY_UNAVAILABLE'));

    await worker.tick();

    expect(sync.waitForDependency).toHaveBeenCalledWith(job, 'DEPENDENCY_UNAVAILABLE');
    expect(sync.retry).not.toHaveBeenCalled();
    expect(sync.fail).not.toHaveBeenCalled();
  });

  it('defers a second invoice job while another pod holds its entity lease', async () => {
    const job = { id: 'job', source: 'internal', entityType: 'invoice', entityId: 'internal-1', operation: 'upsert' };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByInternal.mockResolvedValue(null);
    internal.getSnapshot.mockResolvedValue(snap());
    sync.acquireEntityLease.mockResolvedValue(false);

    await worker.tick();

    expect(sync.acquireEntityLease).toHaveBeenCalledWith('invoice:number:INV-1', expect.any(String));
    expect(sync.defer).toHaveBeenCalledWith(job, 'invoice is already being synchronized');
    expect(qbo.findInvoiceByDocNumber).not.toHaveBeenCalled();
    expect(sync.releaseEntityLease).not.toHaveBeenCalled();
  });

  it('completes a delayed internal event without repeating an already-applied QBO write', async () => {
    const internalNow = snap({ version: '2', total: '15.00' });
    const qboNow = snap({ source: 'qbo', externalId: 'qbo-1', version: '5', total: '15.00' });
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      lastInternalSnapshot: internalNow,
      lastQboSnapshot: qboNow,
    };
    const job = {
      id: 'delayed-create',
      source: 'internal',
      entityType: 'invoice',
      entityId: 'internal-1',
      operation: 'upsert',
    };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByInternal.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalNow);
    qbo.getInvoice.mockResolvedValue(qboNow);

    await worker.tick();

    expect(sync.completeWithLink).toHaveBeenCalledWith(
      job,
      expect.anything(),
      expect.objectContaining({ action: 'already_synchronized' }),
    );
    expect(qbo.updateInvoice).not.toHaveBeenCalled();
    expect(qbo.voidInvoice).not.toHaveBeenCalled();
  });

  it('uses the linked QBO invoice ID when applying an internal update', async () => {
    const base = snap({ total: '1.00', balance: '1.00' });
    const internalNow = snap({ total: '2.00', balance: '2.00', version: '2' });
    const qboNow = snap({ source: 'qbo', externalId: 'qbo-1', total: '1.00', balance: '1.00', version: '5' });
    const updatedQbo = snap({ source: 'qbo', externalId: 'qbo-1', total: '2.00', balance: '2.00', version: '6' });
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      qboSyncToken: '5',
      lastInternalSnapshot: base,
      lastQboSnapshot: { ...base, source: 'qbo', externalId: 'qbo-1' },
    };
    const job = {
      id: 'update',
      source: 'internal',
      entityType: 'invoice',
      entityId: 'internal-1',
      operation: 'upsert',
    };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByInternal.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalNow);
    qbo.getInvoice.mockResolvedValueOnce(qboNow).mockResolvedValueOnce(updatedQbo);
    qbo.updateInvoice.mockResolvedValue(updatedQbo);

    await worker.tick();

    expect(qbo.updateInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'qbo-1', total: '2.00' }),
      '5',
    );
  });

  it('does not flag a conflict when QBO SyncToken is unchanged', async () => {
    const base = snap({ total: '100.00', balance: '100.00' });
    const internalNow = snap({ total: '125.00', balance: '125.00', version: '2' });
    const qboNow = snap({
      source: 'qbo',
      externalId: 'qbo-1',
      total: '100',
      balance: '100',
      dueDate: '2026-02-01',
      version: '5',
    });
    const updatedQbo = snap({ ...qboNow, total: '125', balance: '125', version: '6' });
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      qboSyncToken: '5',
      lastInternalSnapshot: base,
      lastQboSnapshot: qboNow,
    };
    const job = {
      id: 'update',
      source: 'internal',
      entityType: 'invoice',
      entityId: 'internal-1',
      operation: 'upsert',
    };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByInternal.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalNow);
    qbo.getInvoice.mockResolvedValueOnce(qboNow).mockResolvedValueOnce(updatedQbo);
    qbo.updateInvoice.mockResolvedValue(updatedQbo);

    await worker.tick();

    expect(sync.conflict).not.toHaveBeenCalled();
    expect(qbo.updateInvoice).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'qbo-1' }), '5');
  });

  it('applies a QBO-only update instead of creating a conflict', async () => {
    const internalBase = snap({ version: '1', total: '1.00', balance: '1.00' });
    const qboBase = snap({ source: 'qbo', externalId: 'qbo-1', version: '0', total: '1', balance: '1' });
    const qboNow = snap({ source: 'qbo', externalId: 'qbo-1', version: '2', total: '129', balance: '129' });
    const internalFromQbo = snap({ version: '2', total: '129.00', balance: '129.00' });
    const storedInternalBase = Object.fromEntries(Object.entries(internalBase).reverse());
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      qboSyncToken: '0',
      lastInternalSnapshot: storedInternalBase,
      lastQboSnapshot: qboBase,
    };
    const job = { id: 'qbo-update', source: 'qbo', entityType: 'invoice', entityId: 'qbo-1', operation: 'upsert' };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByQbo.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalBase);
    qbo.getInvoice.mockResolvedValue(qboNow);
    internal.upsertFromQboInTransaction.mockResolvedValue(internalFromQbo);
    db.transaction.mockImplementation(async (callback) => callback({}));

    await worker.tick();

    expect(sync.conflict).not.toHaveBeenCalled();
    expect(internal.upsertFromQboInTransaction).toHaveBeenCalledWith(expect.anything(), qboNow, internalBase);
    expect(sync.completeWithLinkInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      job,
      expect.anything(),
      expect.objectContaining({ action: 'updated_internal' }),
    );
  });

  it('does not treat equivalent decimal formatting as an internal edit', async () => {
    const base = snap({
      total: '120',
      balance: '120',
      dueDate: '2026-11-15',
      lines: [{ description: 'Garden supplies', amount: '120', qboItemRef: '19', quantity: '1' }],
    });
    const internalNow = snap({
      total: '120.00',
      balance: '120.00',
      dueDate: '2026-11-15',
      lines: [{ description: 'Garden supplies', amount: '120.00', qboItemRef: '19', quantity: '1.00' }],
    });
    const qboNow = snap({
      source: 'qbo',
      externalId: 'qbo-1',
      total: '120',
      balance: '120',
      issueDate: '2026-10-18',
      dueDate: '2026-10-18',
      lines: [{ description: 'QBO product update', amount: '120', qboItemRef: '20', quantity: '1' }],
      version: '2',
    });
    const internalFromQbo = snap({ ...qboNow, source: 'internal', externalId: 'internal-1', version: '2' });
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      qboSyncToken: '1',
      lastInternalSnapshot: base,
      lastQboSnapshot: { ...base, source: 'qbo', externalId: 'qbo-1', version: '1' },
    };
    const job = {
      id: 'qbo-date-and-product-update',
      source: 'qbo',
      entityType: 'invoice',
      entityId: 'qbo-1',
      operation: 'upsert',
    };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByQbo.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalNow);
    qbo.getInvoice.mockResolvedValue(qboNow);
    internal.upsertFromQboInTransaction.mockResolvedValue(internalFromQbo);
    db.transaction.mockImplementation(async (callback) => callback({}));

    await worker.tick();

    expect(sync.conflict).not.toHaveBeenCalled();
    expect(internal.upsertFromQboInTransaction).toHaveBeenCalledWith(expect.anything(), qboNow, internalNow);
  });

  it('completes a delayed QBO event without repeating an already-applied internal write', async () => {
    const internalNow = snap({ version: '2', total: '15.00' });
    const qboNow = snap({ source: 'qbo', externalId: 'qbo-1', version: '5', total: '15.00' });
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      lastInternalSnapshot: internalNow,
      lastQboSnapshot: qboNow,
    };
    const job = { id: 'delayed-create', source: 'qbo', entityType: 'invoice', entityId: 'qbo-1', operation: 'upsert' };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByQbo.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalNow);
    qbo.getInvoice.mockResolvedValue(qboNow);

    await worker.tick();

    expect(sync.completeWithLink).toHaveBeenCalledWith(
      job,
      expect.anything(),
      expect.objectContaining({ action: 'already_synchronized' }),
    );
    expect(internal.upsertFromQboInTransaction).not.toHaveBeenCalled();
  });

  it('turns a linked QBO delete notification into an internal deleted tombstone without refetching QBO', async () => {
    const internalNow = snap({ version: '2' });
    const qboBeforeDelete = snap({ source: 'qbo', externalId: 'qbo-1', version: '5' });
    const deletedInternal = snap({ version: '3', status: 'DELETED' });
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      qboSyncToken: '5',
      lastInternalSnapshot: internalNow,
      lastQboSnapshot: qboBeforeDelete,
    };
    const job = { id: 'deleted-qbo', source: 'qbo', entityType: 'invoice', entityId: 'qbo-1', operation: 'delete' };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByQbo.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalNow);
    internal.markDeletedFromQboInTransaction.mockResolvedValue(deletedInternal);
    db.transaction.mockImplementation(async (callback) => callback({}));

    await worker.tick();

    expect(qbo.getInvoice).not.toHaveBeenCalled();
    expect(internal.markDeletedFromQboInTransaction).toHaveBeenCalledWith(expect.anything(), internalNow);
    expect(sync.completeWithLinkInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      job,
      expect.anything(),
      expect.objectContaining({ action: 'deleted_internal_from_qbo' }),
    );
  });

  it('treats an internal deleted status as a QBO delete instead of a void', async () => {
    const internalDeleted = snap({ version: '2', status: 'DELETED' });
    const qboNow = snap({ source: 'qbo', externalId: 'qbo-1', version: '5' });
    const link = {
      id: 'link-1',
      internalInvoiceId: 'internal-1',
      qboInvoiceId: 'qbo-1',
      lastInternalSnapshot: snap(),
      lastQboSnapshot: qboNow,
    };
    const job = {
      id: 'deleted-internal',
      source: 'internal',
      entityType: 'invoice',
      entityId: 'internal-1',
      operation: 'delete',
    };
    sync.claim.mockResolvedValue(job);
    sync.findLinkByInternal.mockResolvedValue(link);
    internal.getSnapshot.mockResolvedValue(internalDeleted);
    qbo.getInvoice.mockResolvedValue(qboNow);

    await worker.tick();

    expect(qbo.deleteInvoice).toHaveBeenCalledWith('qbo-1', '5');
    expect(qbo.voidInvoice).not.toHaveBeenCalled();
  });
});
