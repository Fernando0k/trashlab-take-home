import { Injectable } from '@nestjs/common';
import { ExternalServiceError } from '../../../shared/errors/application-error';
import { InvoiceSnapshot } from '../../invoicing/domain/invoice';
import { QboInvoiceClient } from '../domain/qbo-invoice.port';
import { QboPaymentClient } from '../domain/qbo-payment.port';
import { QboHttpClient } from '../infrastructure/qbo-http.client';
import { qboQueryPath } from '../infrastructure/qbo-urls';
import { QboConnectionService } from './qbo-connection.service';
import { QboInvoice, toQboInvoice, toQboInvoiceSnapshot } from './qbo-invoice.mapper';
import { QboPayment, toPaymentSnapshot } from './qbo-payment.mapper';

const INITIAL_REQUEST_ATTEMPT = 0;
const RELOAD_SHARED_TOKEN_ATTEMPT = 1;
const FORCE_TOKEN_REFRESH_ATTEMPT = 2;
type RequestAttempt =
  typeof INITIAL_REQUEST_ATTEMPT | typeof RELOAD_SHARED_TOKEN_ATTEMPT | typeof FORCE_TOKEN_REFRESH_ATTEMPT;

/** Shared QBO Accounting API adapter; the exported ports keep consumers focused. */
@Injectable()
export class QboAccountingClient implements QboInvoiceClient, QboPaymentClient {
  constructor(
    private readonly http: QboHttpClient,
    private readonly connections: QboConnectionService,
  ) {}

  async getInvoice(id: string): Promise<InvoiceSnapshot> {
    return toQboInvoiceSnapshot(
      await this.request<{ Invoice: QboInvoice }>(`/invoice/${id}`, 'GET').then((x) => x.Invoice),
    );
  }

  async findInvoiceByDocNumber(number: string): Promise<InvoiceSnapshot | null> {
    const escaped = number.replace(/'/g, "\\'");
    const data = await this.request<{ QueryResponse: { Invoice?: QboInvoice[] } }>(
      qboQueryPath(`select * from Invoice where DocNumber = '${escaped}'`),
      'GET',
    );
    const invoices = data.QueryResponse.Invoice ?? [];
    if (invoices.length > 1) throw new Error(`Ambiguous QBO DocNumber match for ${number}`);
    return invoices[0] ? toQboInvoiceSnapshot(invoices[0]) : null;
  }

  async createInvoice(invoice: InvoiceSnapshot): Promise<InvoiceSnapshot> {
    return toQboInvoiceSnapshot(
      (await this.request<{ Invoice: QboInvoice }>('/invoice', 'POST', toQboInvoice(invoice))).Invoice,
    );
  }

  async updateInvoice(invoice: InvoiceSnapshot, syncToken: string): Promise<InvoiceSnapshot> {
    return toQboInvoiceSnapshot(
      (
        await this.request<{ Invoice: QboInvoice }>('/invoice', 'POST', {
          ...toQboInvoice(invoice),
          Id: invoice.externalId,
          SyncToken: syncToken,
          sparse: false,
        })
      ).Invoice,
    );
  }

  async voidInvoice(id: string, syncToken: string): Promise<InvoiceSnapshot> {
    return toQboInvoiceSnapshot(
      (
        await this.request<{ Invoice: QboInvoice }>('/invoice?operation=void', 'POST', {
          Id: id,
          SyncToken: syncToken,
          sparse: true,
        })
      ).Invoice,
    );
  }

  async deleteInvoice(id: string, syncToken: string): Promise<void> {
    await this.request('/invoice?operation=delete', 'POST', { Id: id, SyncToken: syncToken });
  }

  async getPayment(id: string) {
    return toPaymentSnapshot(
      await this.request<{ Payment: QboPayment }>(`/payment/${id}`, 'GET').then((x) => x.Payment),
    );
  }

  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const realm = await this.connections.activeRealmId();
    return this.requestWithToken<T>(realm, path, method, body, INITIAL_REQUEST_ATTEMPT);
  }

  private async requestWithToken<T>(
    realm: string,
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    attempt: RequestAttempt,
  ): Promise<T> {
    const token = await this.connections.accessToken(
      realm,
      attempt > INITIAL_REQUEST_ATTEMPT,
      attempt === FORCE_TOKEN_REFRESH_ATTEMPT,
    );
    try {
      return await this.http.accounting<T>(`/v3/company/${realm}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (error instanceof ExternalServiceError && error.statusCode === 401) {
        if (attempt === INITIAL_REQUEST_ATTEMPT) {
          return this.requestWithToken(realm, path, method, body, RELOAD_SHARED_TOKEN_ATTEMPT);
        }
        if (attempt === RELOAD_SHARED_TOKEN_ATTEMPT) {
          return this.requestWithToken(realm, path, method, body, FORCE_TOKEN_REFRESH_ATTEMPT);
        }
      }
      throw error;
    }
  }
}
