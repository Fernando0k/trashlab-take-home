import { InvoiceSnapshot } from '../../invoicing/domain/invoice';

/**
 * Only conflict/link snapshots are durable business contracts. Job payloads and
 * audit details are diagnostic JSON and deliberately remain unversioned.
 *
 * When a durable schema must change, add its explicit type, widen
 * StoredInvoiceSnapshot, and add a reader branch below. Keep prior reader
 * branches until every persisted snapshot using them has been migrated.
 */
export const CURRENT_INVOICE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type StoredInvoiceSnapshotV1 = {
  version: typeof CURRENT_INVOICE_SNAPSHOT_SCHEMA_VERSION;
  data: InvoiceSnapshot;
};

export type StoredInvoiceSnapshot = StoredInvoiceSnapshotV1;

export function storeInvoiceSnapshot(data: InvoiceSnapshot): StoredInvoiceSnapshot {
  return { version: CURRENT_INVOICE_SNAPSHOT_SCHEMA_VERSION, data };
}

/** Supports raw snapshots written before this convention. */
export function readInvoiceSnapshot(value: StoredInvoiceSnapshot | InvoiceSnapshot): InvoiceSnapshot {
  if (isStoredInvoiceSnapshot(value)) {
    return readStoredInvoiceSnapshot(value);
  }

  return value as InvoiceSnapshot;
}

function isStoredInvoiceSnapshot(value: unknown): value is { version: unknown; data: unknown } {
  return typeof value === 'object' && value !== null && 'version' in value && 'data' in value;
}

function readStoredInvoiceSnapshot(stored: { version: unknown; data: unknown }): InvoiceSnapshot {
  switch (stored.version) {
    case CURRENT_INVOICE_SNAPSHOT_SCHEMA_VERSION:
      return stored.data as InvoiceSnapshot;
    default:
      throw new Error(`Unsupported invoice snapshot version: ${String(stored.version)}`);
  }
}
