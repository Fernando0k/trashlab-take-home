/** DELETED is a retained tombstone; internal invoices are never physically deleted. */
export const INVOICE_STATUSES = ['OPEN', 'PAID', 'VOID', 'DELETED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS = {
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
  DELETED: 'DELETED',
} as const satisfies Record<string, InvoiceStatus>;
export const INVOICE_SOURCES = ['internal', 'qbo'] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];
/** qboItemRef is a QBO Item Id; its IncomeAccountRef supplies the GL posting account. */
export interface InvoiceLine {
  description: string;
  amount: string;
  qboItemRef: string;
  quantity?: string;
}
export interface InvoiceSnapshot {
  source: InvoiceSource;
  externalId: string;
  number: string;
  customerRef: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  total: string;
  balance: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  version: string;
  updatedAt: string;
}
