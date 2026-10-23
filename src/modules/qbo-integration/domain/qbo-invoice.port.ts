import { InvoiceSnapshot } from '../../invoicing/domain/invoice';

export const QBO_INVOICE_CLIENT = Symbol('QBO_INVOICE_CLIENT');
export interface QboInvoiceClient {
  getInvoice(id: string): Promise<InvoiceSnapshot>;
  findInvoiceByDocNumber(number: string): Promise<InvoiceSnapshot | null>;
  createInvoice(invoice: InvoiceSnapshot): Promise<InvoiceSnapshot>;
  updateInvoice(invoice: InvoiceSnapshot, syncToken: string): Promise<InvoiceSnapshot>;
  voidInvoice(id: string, syncToken: string): Promise<InvoiceSnapshot>;
  deleteInvoice(id: string, syncToken: string): Promise<void>;
}
