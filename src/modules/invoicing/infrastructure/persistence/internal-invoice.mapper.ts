import { InvoiceSnapshot } from '../../domain/invoice';
import { InternalInvoiceEntity } from './internal-invoice.entity';

export function toInternalInvoiceSnapshot(invoice: InternalInvoiceEntity): InvoiceSnapshot {
  return {
    source: 'internal',
    externalId: invoice.id,
    number: invoice.number,
    customerRef: invoice.customerRef,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    total: invoice.total,
    balance: invoice.balance,
    status: invoice.status,
    lines: invoice.lines as InvoiceSnapshot['lines'],
    version: String(invoice.version),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

export function newInternalInvoiceFromQbo(qbo: InvoiceSnapshot): Partial<InternalInvoiceEntity> {
  return {
    id: crypto.randomUUID(),
    number: qbo.number,
    customerRef: qbo.customerRef,
    issueDate: qbo.issueDate,
    dueDate: qbo.dueDate,
    currency: qbo.currency,
    total: qbo.total,
    balance: qbo.balance,
    status: qbo.status,
    lines: qbo.lines,
    version: 1,
  };
}

export function applyQboSnapshot(invoice: InternalInvoiceEntity, qbo: InvoiceSnapshot): InternalInvoiceEntity {
  Object.assign(invoice, {
    customerRef: qbo.customerRef,
    issueDate: qbo.issueDate,
    dueDate: qbo.dueDate,
    currency: qbo.currency,
    total: qbo.total,
    balance: qbo.balance,
    status: qbo.status,
    lines: qbo.lines,
    version: invoice.version + 1,
  });
  return invoice;
}
