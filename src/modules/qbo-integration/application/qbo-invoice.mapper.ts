import { InvoiceSnapshot } from '../../invoicing/domain/invoice';

export type QboInvoice = {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  CustomerRef: { value: string };
  TxnDate: string;
  DueDate?: string;
  CurrencyRef?: { value: string };
  TotalAmt: number;
  Balance: number;
  TxnStatus?: string;
  MetaData?: { LastUpdatedTime: string };
  Line: Array<{
    Description?: string;
    Amount: number;
    SalesItemLineDetail?: { ItemRef?: { value: string }; Qty?: number };
  }>;
};

export function toQboInvoice(invoice: InvoiceSnapshot): object {
  return {
    DocNumber: invoice.number,
    CustomerRef: { value: invoice.customerRef },
    TxnDate: invoice.issueDate,
    ...(invoice.dueDate ? { DueDate: invoice.dueDate } : {}),
    CurrencyRef: { value: invoice.currency },
    Line: invoice.lines.map((line) => ({
      Amount: Number(line.amount),
      Description: line.description,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: line.qboItemRef },
        ...(line.quantity ? { Qty: Number(line.quantity) } : {}),
      },
    })),
  };
}

export function toQboInvoiceSnapshot(qbo: QboInvoice): InvoiceSnapshot {
  return {
    source: 'qbo',
    externalId: qbo.Id,
    number: qbo.DocNumber ?? qbo.Id,
    customerRef: qbo.CustomerRef.value,
    issueDate: qbo.TxnDate,
    dueDate: qbo.DueDate,
    currency: qbo.CurrencyRef?.value ?? 'USD',
    total: String(qbo.TotalAmt),
    balance: String(qbo.Balance),
    status: qbo.TxnStatus === 'Voided' ? 'VOID' : qbo.Balance === 0 ? 'PAID' : 'OPEN',
    lines: qbo.Line.filter((line) => line.SalesItemLineDetail).map((line) => ({
      description: line.Description ?? '',
      amount: String(line.Amount),
      qboItemRef: line.SalesItemLineDetail?.ItemRef?.value ?? '',
      quantity: line.SalesItemLineDetail?.Qty?.toString(),
    })),
    version: qbo.SyncToken,
    updatedAt: qbo.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
  };
}
