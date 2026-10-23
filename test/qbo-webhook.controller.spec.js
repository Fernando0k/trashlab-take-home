const { QboWebhookController } = require('../dist/modules/qbo-integration/api/qbo-webhook.controller');

describe('QboWebhookController', () => {
  const connections = { activeRealmId: vi.fn() };
  const sync = { enqueue: vi.fn() };
  let controller;

  beforeEach(() => {
    vi.clearAllMocks();
    connections.activeRealmId.mockResolvedValue('realm-1');
    sync.enqueue.mockResolvedValue(undefined);
    controller = new QboWebhookController(connections, sync);
  });

  it('queues an Invoice CloudEvent using the provider event ID for idempotency', async () => {
    await controller.receive(
      [
        {
          id: 'event-1',
          type: 'qbo.invoice.updated.v1',
          intuitentityid: '173',
          intuitaccountid: 'realm-1',
        },
      ],
      'signature',
    );

    expect(sync.enqueue).toHaveBeenCalledWith({
      dedupeKey: 'qbo:invoice:173:event-1',
      source: 'qbo',
      entityType: 'invoice',
      entityId: '173',
      operation: 'upsert',
      payload: { eventId: 'event-1' },
    });
  });

  it('accepts the single CloudEvent object used by the Intuit dashboard test', async () => {
    await controller.receive({
      id: 'event-1',
      type: 'qbo.invoice.created.v1',
      intuitentityid: '173',
      intuitaccountid: 'realm-1',
    });

    expect(sync.enqueue).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'qbo:invoice:173:event-1' }));
  });

  it('queues a deleted Invoice CloudEvent as a delete job', async () => {
    await controller.receive(
      [
        {
          id: 'event-2',
          type: 'qbo.invoice.deleted.v1',
          intuitentityid: '173',
          intuitaccountid: 'realm-1',
        },
      ],
      'signature',
    );

    expect(sync.enqueue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'delete' }));
  });

  it('queues a Payment CloudEvent for payment-status reconciliation', async () => {
    await controller.receive({
      id: 'payment-event-1',
      type: 'qbo.payment.updated.v1',
      intuitentityid: 'payment-1',
      intuitaccountid: 'realm-1',
    });

    expect(sync.enqueue).toHaveBeenCalledWith({
      dedupeKey: 'qbo:payment:payment-1:payment-event-1',
      source: 'qbo',
      entityType: 'payment',
      entityId: 'payment-1',
      operation: 'upsert',
      payload: { eventId: 'payment-event-1' },
    });
  });

  it('continues to accept the legacy eventNotifications payload during migration', async () => {
    await controller.receive(
      {
        eventNotifications: [
          {
            realmId: 'realm-1',
            dataChangeEvent: { entities: [{ name: 'Invoice', id: '173', operation: 'Update', lastUpdated: 'time-1' }] },
          },
        ],
      },
      'signature',
    );

    expect(sync.enqueue).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'qbo:invoice:173:time-1' }));
  });

  it('acknowledges permanent non-actionable events without queuing them', async () => {
    await expect(
      controller.receive(
        [
          {
            id: 'event-3',
            type: 'qbo.customer.updated.v1',
            intuitentityid: '58',
            intuitaccountid: 'realm-1',
          },
          {
            id: 'event-4',
            type: 'qbo.invoice.updated.v1',
            intuitentityid: '173',
            intuitaccountid: 'other-realm',
          },
        ],
        'signature',
      ),
    ).resolves.toEqual({ acknowledged: true });

    expect(sync.enqueue).not.toHaveBeenCalled();
  });

  it('does not acknowledge a webhook when its durable queue write fails', async () => {
    sync.enqueue.mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.receive({
        id: 'event-5',
        type: 'qbo.invoice.updated.v1',
        intuitentityid: '173',
        intuitaccountid: 'realm-1',
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('does not acknowledge a webhook when the active realm cannot be resolved', async () => {
    connections.activeRealmId.mockRejectedValue(new Error('database unavailable'));

    await expect(controller.receive([])).rejects.toThrow('database unavailable');
    expect(sync.enqueue).not.toHaveBeenCalled();
  });
});
