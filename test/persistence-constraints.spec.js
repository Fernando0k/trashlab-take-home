const { SyncSchema1730000000000 } = require('../dist/database/migrations/1730000000000-SyncSchema');

describe('persistence lifecycle constraints', () => {
  it('adds a check constraint for every persisted lifecycle value', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new SyncSchema1730000000000();

    await migration.up({ query });

    const statements = query.mock.calls.map(([sql]) => sql).join('\n');

    expect(statements).toContain(
      "internal_invoices_status_check CHECK (status IN ('OPEN', 'PAID', 'VOID', 'DELETED'))",
    );
    expect(statements).toContain("sync_jobs_source_check CHECK (source IN ('internal', 'qbo'))");
    expect(statements).toContain(
      "sync_jobs_entity_type_check CHECK (\"entityType\" IN ('invoice', 'payment', 'account'))",
    );
    expect(statements).toContain(
      "sync_jobs_operation_check CHECK (operation IN ('upsert', 'void', 'delete', 'discover'))",
    );
    expect(statements).toContain(
      "sync_jobs_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'CONFLICT'))",
    );
    expect(statements).toContain("qbo_connections_status_check CHECK (status IN ('ACTIVE', 'REAUTH_REQUIRED'))");
    expect(statements).toContain("sync_conflicts_status_check CHECK (status IN ('OPEN', 'RESOLVED'))");
    expect(statements).toContain('CREATE TABLE internal_payments');
    expect(statements).toContain("internal_payments_status_check CHECK (status IN ('ACTIVE', 'DELETED'))");
    expect(statements).toContain('CREATE TABLE payment_allocations');
    expect(statements).toContain('payment_allocations_payment_invoice_unique');
    expect(statements).toContain('payment_allocations_qbo_invoice_idx');
  });
});
