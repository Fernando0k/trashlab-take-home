import { InvoiceSnapshot } from './invoice';
import { EntityManager } from 'typeorm';

export const INTERNAL_INVOICE_PORT = Symbol('INTERNAL_INVOICE_PORT');

export interface InternalInvoicePort {
  getSnapshot(id: string): Promise<InvoiceSnapshot>;
  findSnapshotByNumber(number: string): Promise<InvoiceSnapshot | null>;
  upsertFromQbo(qbo: InvoiceSnapshot, existing?: InvoiceSnapshot): Promise<InvoiceSnapshot>;
  upsertFromQboInTransaction(
    manager: EntityManager,
    qbo: InvoiceSnapshot,
    existing?: InvoiceSnapshot,
  ): Promise<InvoiceSnapshot>;
  markDeletedFromQboInTransaction(manager: EntityManager, existing: InvoiceSnapshot): Promise<InvoiceSnapshot>;
}
