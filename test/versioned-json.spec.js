const {
  CURRENT_INVOICE_SNAPSHOT_SCHEMA_VERSION,
  readInvoiceSnapshot,
  storeInvoiceSnapshot,
} = require('../dist/modules/sync-orchestrator/domain/versioned-json');

describe('stored invoice snapshots', () => {
  const snapshot = { number: 'INV-1' };

  it('writes a small versioned envelope and can read legacy raw snapshots', () => {
    expect(storeInvoiceSnapshot(snapshot)).toEqual({
      version: CURRENT_INVOICE_SNAPSHOT_SCHEMA_VERSION,
      data: snapshot,
    });
    expect(readInvoiceSnapshot(snapshot)).toEqual(snapshot);
  });

  it('reads the current stored snapshot variant', () => {
    expect(
      readInvoiceSnapshot({
        version: CURRENT_INVOICE_SNAPSHOT_SCHEMA_VERSION,
        data: snapshot,
      }),
    ).toEqual(snapshot);
  });

  it('rejects a future snapshot version rather than silently comparing it', () => {
    expect(() => readInvoiceSnapshot({ version: 2, data: snapshot })).toThrow(
      'Unsupported invoice snapshot version: 2',
    );
  });
});
