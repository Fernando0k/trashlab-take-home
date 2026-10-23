const { SyncRepository } = require('../dist/modules/sync-orchestrator/infrastructure/sync.repository');

const config = { app: { sync: { entityLeaseMs: 30_000, jobLeaseMs: 30_000 } } };

describe('SyncRepository ORM persistence', () => {
  it('uses TypeORM insert conflict handling for idempotent enqueue', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const orIgnore = vi.fn(() => ({ execute }));
    const values = vi.fn(() => ({ orIgnore }));
    const into = vi.fn(() => ({ values }));
    const insert = vi.fn(() => ({ into }));
    const createQueryBuilder = vi.fn(() => ({ insert }));
    const database = { getRepository: vi.fn(() => ({ createQueryBuilder })) };
    const sync = new SyncRepository(database, config, {}, {});

    await sync.enqueue({
      dedupeKey: 'internal:invoice:one:v1',
      source: 'internal',
      entityType: 'invoice',
      entityId: 'one',
      operation: 'upsert',
      payload: { version: 1 },
    });

    expect(orIgnore).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'internal:invoice:one:v1' }));
  });

  it('claims one eligible job under an ORM pessimistic skip-locked transaction', async () => {
    const job = { id: 'job-1', status: 'PENDING', lockedAt: null };
    const manager = {
      findOne: vi.fn().mockResolvedValue(job),
      save: vi.fn().mockImplementation(async (entity) => entity),
    };
    const database = {
      transaction: vi.fn((callback) => callback(manager)),
    };
    const sync = new SyncRepository(database, config, {}, {});

    const claimed = await sync.claim();

    expect(claimed.status).toBe('PROCESSING');
    expect(claimed.lockedAt).toBeInstanceOf(Date);
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' } }),
    );
    expect(manager.save).toHaveBeenCalledWith(job);
  });

  it('uses TypeORM insert identifiers to acquire a new entity lease', async () => {
    const execute = vi.fn().mockResolvedValue({ identifiers: [{ entityKey: 'invoice:number:INV-1' }] });
    const returning = vi.fn(() => ({ execute }));
    const orIgnore = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ orIgnore }));
    const into = vi.fn(() => ({ values }));
    const insert = vi.fn(() => ({ into }));
    const entityLeases = {
      createQueryBuilder: vi.fn(() => ({ insert })),
      update: vi.fn(),
    };
    const sync = new SyncRepository({}, config, {}, entityLeases);

    await expect(sync.acquireEntityLease('invoice:number:INV-1', 'worker-1')).resolves.toBe(true);

    expect(returning).toHaveBeenCalledWith('"entityKey"');
    expect(entityLeases.update).not.toHaveBeenCalled();
  });
});
