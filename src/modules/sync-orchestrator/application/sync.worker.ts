import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import {
  DependencyUnavailableError,
  errorDetails,
  ExternalServiceError,
  isRetryable,
} from '../../../shared/errors/application-error';
import { INTERNAL_INVOICE_PORT, InternalInvoicePort } from '../../invoicing/domain/internal-invoice.port';
import { INVOICE_STATUS, InvoiceSnapshot } from '../../invoicing/domain/invoice';
import { QBO_INVOICE_CLIENT, QboInvoiceClient } from '../../qbo-integration/domain/qbo-invoice.port';
import { QBO_PAYMENT_CLIENT, QboPaymentClient } from '../../qbo-integration/domain/qbo-payment.port';
import { INTERNAL_PAYMENT_PORT, InternalPaymentPort } from '../../payments/domain/internal-payment.port';
import { SYNC_ENTITY_TYPE, SYNC_OPERATION, SYNC_SOURCE } from '../domain/sync-values';
import { readInvoiceSnapshot, storeInvoiceSnapshot } from '../domain/versioned-json';
import { InvoiceLinkEntity } from '../infrastructure/persistence/invoice-link.entity';
import { SyncJobEntity } from '../infrastructure/persistence/sync-job.entity';
import { SyncRepository } from '../infrastructure/sync.repository';
import { AppConfig } from '../../../shared/config/app-config.service';

const ENTITY_LEASE_HELD_REASON = 'invoice is already being synchronized';
const SYNC_POLL_INTERVAL_NAME = 'sync-outbox-poll';
const SYNC_ACTION = {
  ALREADY_DELETED_INTERNAL: 'already_deleted_internal',
  ALREADY_DELETED_QBO: 'already_deleted_qbo',
  ALREADY_DELETED_QBO_WITHOUT_LINK: 'already_deleted_qbo_without_link',
  ALREADY_SYNCHRONIZED: 'already_synchronized',
  CREATED_INTERNAL: 'created_internal',
  CREATED_QBO: 'created_qbo',
  DELETED_INTERNAL_FROM_QBO: 'deleted_internal_from_qbo',
  DELETED_QBO: 'deleted_qbo',
  IGNORED_DELETED_QBO_WITHOUT_LINK: 'ignored_deleted_qbo_without_link',
  OUTSIDE_INVOICE_SCOPE: 'outside invoice scope',
  PAYMENT_STATUS_RECONCILIATION_QUEUED: 'payment_status_reconciliation_queued',
  UPDATED_INTERNAL: 'updated_internal',
  UPDATED_QBO: 'updated_qbo',
  VOIDED_QBO: 'voided_qbo',
} as const;

type SyncAction = (typeof SYNC_ACTION)[keyof typeof SYNC_ACTION];
type CompletionDetails = { action: SyncAction; internalInvoiceId?: string; qboInvoiceId?: string };
type EntityLease = { key: string; owner: string };
type InvoiceLeaseResolution = { key: string; sourceSnapshot?: InvoiceSnapshot };
type JobPreparation = { state: 'deferred' } | { state: 'ready'; lease?: EntityLease; sourceSnapshot?: InvoiceSnapshot };
type QboWriteResult = { action: SyncAction; snapshot: InvoiceSnapshot };
type ProcessingTrace = { stage: string };
type ComparableInvoice = Pick<
  InvoiceSnapshot,
  'number' | 'customerRef' | 'issueDate' | 'dueDate' | 'currency' | 'total' | 'balance' | 'status' | 'lines'
>;

@Injectable()
export class SyncWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SyncWorker.name);
  private isPolling = false;

  constructor(
    private readonly sync: SyncRepository,
    private readonly db: DataSource,
    private readonly config: AppConfig,
    private readonly scheduler: SchedulerRegistry,
    @Inject(INTERNAL_INVOICE_PORT) private readonly internal: InternalInvoicePort,
    @Inject(INTERNAL_PAYMENT_PORT) private readonly payments: InternalPaymentPort,
    @Inject(QBO_INVOICE_CLIENT) private readonly qboInvoices: QboInvoiceClient,
    @Inject(QBO_PAYMENT_CLIENT) private readonly qboPayments: QboPaymentClient,
  ) {}

  onApplicationBootstrap(): void {
    const pollIntervalMs = this.config.app.sync.pollIntervalMs;
    const interval = setInterval(() => void this.poll(), pollIntervalMs);
    this.scheduler.addInterval(SYNC_POLL_INTERVAL_NAME, interval);
    this.logger.log({ event: 'sync_worker_started', pollIntervalMs });
    void this.poll();
  }

  onApplicationShutdown(): void {
    const intervalRemoved = this.scheduler.doesExist('interval', SYNC_POLL_INTERVAL_NAME);
    if (intervalRemoved) {
      this.scheduler.deleteInterval(SYNC_POLL_INTERVAL_NAME);
    }
    this.logger.log({ event: 'sync_worker_shutdown', intervalRemoved });
  }

  async poll(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this.tick();
    } catch (error) {
      this.logPollingFailure(error);
    } finally {
      this.isPolling = false;
    }
  }

  async tick(): Promise<void> {
    const job = await this.sync.claim();
    if (!job) return;

    this.logJob('sync_job_claimed', job);

    let lease: EntityLease | undefined;
    const trace: ProcessingTrace = { stage: 'acquiring_entity_lease' };
    try {
      const preparation = await this.prepareJob(job, trace);
      if (preparation.state === 'deferred') {
        this.logJob('sync_job_deferred', job);
        return;
      }
      lease = preparation.lease;
      await this.process(job, preparation.sourceSnapshot, trace);
      this.logJob('sync_job_processing_finished', job);
    } catch (error) {
      await this.handleProcessingError(job, error, trace.stage);
    } finally {
      if (lease) await this.releaseEntityLease(lease);
    }
  }

  private async prepareJob(job: SyncJobEntity, trace: ProcessingTrace): Promise<JobPreparation> {
    if (job.entityType !== SYNC_ENTITY_TYPE.INVOICE) return { state: 'ready' };

    trace.stage = 'resolving_entity_lease';
    const resolution = await this.resolveInvoiceLease(job);
    const lease = { key: resolution.key, owner: randomUUID() };
    trace.stage = 'acquiring_entity_lease';
    if (await this.sync.acquireEntityLease(lease.key, lease.owner)) {
      return { state: 'ready', lease, sourceSnapshot: resolution.sourceSnapshot };
    }

    await this.sync.defer(job, ENTITY_LEASE_HELD_REASON);
    return { state: 'deferred' };
  }

  private async process(
    job: SyncJobEntity,
    sourceSnapshot: InvoiceSnapshot | undefined,
    trace: ProcessingTrace,
  ): Promise<void> {
    switch (job.entityType) {
      case SYNC_ENTITY_TYPE.PAYMENT:
        return this.syncPaymentStatus(job, trace);
      case SYNC_ENTITY_TYPE.INVOICE:
        return this.processInvoice(job, sourceSnapshot, trace);
      default:
        return this.sync.done(job, { skipped: SYNC_ACTION.OUTSIDE_INVOICE_SCOPE });
    }
  }

  private processInvoice(
    job: SyncJobEntity,
    sourceSnapshot: InvoiceSnapshot | undefined,
    trace: ProcessingTrace,
  ): Promise<void> {
    switch (job.source) {
      case SYNC_SOURCE.INTERNAL:
        return this.syncInternalInvoice(job, sourceSnapshot, trace);
      case SYNC_SOURCE.QBO:
        return job.operation === SYNC_OPERATION.DELETE
          ? this.syncQboDeletion(job)
          : this.syncQboInvoice(job, sourceSnapshot);
    }
  }

  private async syncPaymentStatus(job: SyncJobEntity, trace: ProcessingTrace): Promise<void> {
    if (job.operation === SYNC_OPERATION.DELETE) {
      trace.stage = 'persisting_deleted_qbo_payment';
      await this.db.transaction(async (manager) => {
        const invoiceIds = await this.payments.markDeletedFromQboInTransaction(manager, job.entityId);
        await this.completePaymentReconciliation(manager, job, job.entityId, 'deleted', invoiceIds);
      });
      return;
    }

    trace.stage = 'loading_qbo_payment';
    const payment = await this.qboPayments.getPayment(job.entityId);
    trace.stage = 'persisting_qbo_payment';
    await this.db.transaction(async (manager) => {
      const invoiceIds = await this.payments.upsertFromQboInTransaction(manager, payment);
      await this.completePaymentReconciliation(manager, job, payment.qboPaymentId, payment.qboSyncToken, invoiceIds);
    });
  }

  private async completePaymentReconciliation(
    manager: EntityManager,
    job: SyncJobEntity,
    paymentId: string,
    paymentVersion: string,
    invoiceIds: string[],
  ): Promise<void> {
    await this.enqueuePaymentInvoiceReconciliations(manager, job, paymentId, paymentVersion, invoiceIds);
    await this.sync.doneInTransaction(manager, job, {
      action: SYNC_ACTION.PAYMENT_STATUS_RECONCILIATION_QUEUED,
      invoiceCount: invoiceIds.length,
    });
  }

  private async enqueuePaymentInvoiceReconciliations(
    manager: EntityManager,
    job: SyncJobEntity,
    paymentId: string,
    paymentVersion: string,
    invoiceIds: string[],
  ): Promise<void> {
    for (const invoiceId of invoiceIds) {
      await this.sync.enqueueInTransaction(manager, {
        dedupeKey: `qbo:payment:${paymentId}:v${paymentVersion}:invoice:${invoiceId}`,
        source: SYNC_SOURCE.QBO,
        entityType: SYNC_ENTITY_TYPE.INVOICE,
        entityId: invoiceId,
        operation: SYNC_OPERATION.UPSERT,
        payload: { paymentId, paymentVersion, sourceJobId: job.id },
      });
    }
  }

  private async syncInternalInvoice(
    job: SyncJobEntity,
    sourceSnapshot: InvoiceSnapshot | undefined,
    trace: ProcessingTrace,
  ): Promise<void> {
    const internal = sourceSnapshot ?? (await this.internal.getSnapshot(job.entityId));
    const link = await this.ensureQboLink(job, internal, trace);
    if (!link) return;

    trace.stage = 'loading_qbo_invoice';
    const qbo = await this.loadQboForInternal(job, internal, link);
    if (!qbo) return;
    if (!this.changed(internal, qbo)) {
      await this.complete(job, internal, qbo, link, {
        action: SYNC_ACTION.ALREADY_SYNCHRONIZED,
        qboInvoiceId: qbo.externalId,
      });
      return;
    }
    if (this.concurrentChange(link, internal, qbo)) {
      await this.sync.conflict(job, link, internal, qbo);
      this.logJob('sync_job_conflict_detected', job);
      return;
    }

    trace.stage = 'writing_qbo_invoice';
    const written = await this.writeInternalChangeToQbo(internal, qbo, link);
    trace.stage = 'persisting_sync_result';
    await this.complete(job, internal, written.snapshot, link, {
      action: written.action,
      qboInvoiceId: written.snapshot.externalId,
    });
  }

  private async ensureQboLink(
    job: SyncJobEntity,
    internal: InvoiceSnapshot,
    trace: ProcessingTrace,
  ): Promise<InvoiceLinkEntity | undefined> {
    const existingLink = await this.sync.findLinkByInternal(internal.externalId);
    if (existingLink) return existingLink;

    trace.stage = 'looking_up_qbo_invoice_by_doc_number';
    const existingQbo = await this.qboInvoices.findInvoiceByDocNumber(internal.number);
    if (existingQbo) {
      trace.stage = 'persisting_discovered_qbo_link';
      return this.link(internal, existingQbo);
    }
    if (internal.status === INVOICE_STATUS.DELETED) {
      await this.sync.done(job, { action: SYNC_ACTION.ALREADY_DELETED_QBO_WITHOUT_LINK });
      return undefined;
    }

    trace.stage = 'creating_qbo_invoice';
    const createdQbo = await this.qboInvoices.createInvoice(internal);
    trace.stage = 'refetching_created_qbo_invoice';
    const canonicalQbo = await this.qboInvoices.getInvoice(createdQbo.externalId);
    trace.stage = 'persisting_created_qbo_link';
    await this.complete(job, internal, canonicalQbo, undefined, {
      action: SYNC_ACTION.CREATED_QBO,
      qboInvoiceId: canonicalQbo.externalId,
    });
    return undefined;
  }

  private async loadQboForInternal(
    job: SyncJobEntity,
    internal: InvoiceSnapshot,
    link: InvoiceLinkEntity,
  ): Promise<InvoiceSnapshot | undefined> {
    try {
      return await this.qboInvoices.getInvoice(link.qboInvoiceId);
    } catch (error) {
      if (internal.status !== INVOICE_STATUS.DELETED || !this.isNotFound(error)) throw error;
      await this.complete(job, internal, this.deletedQboSnapshot(this.lastQboSnapshot(link, internal)), link, {
        action: SYNC_ACTION.ALREADY_DELETED_QBO,
        qboInvoiceId: link.qboInvoiceId,
      });
      return undefined;
    }
  }

  private async writeInternalChangeToQbo(
    internal: InvoiceSnapshot,
    qbo: InvoiceSnapshot,
    link: InvoiceLinkEntity,
  ): Promise<QboWriteResult> {
    switch (internal.status) {
      case INVOICE_STATUS.DELETED:
        await this.qboInvoices.deleteInvoice(link.qboInvoiceId, qbo.version);
        return { action: SYNC_ACTION.DELETED_QBO, snapshot: this.deletedQboSnapshot(qbo) };
      case INVOICE_STATUS.VOID: {
        const voided = await this.qboInvoices.voidInvoice(link.qboInvoiceId, qbo.version);
        return { action: SYNC_ACTION.VOIDED_QBO, snapshot: await this.qboInvoices.getInvoice(voided.externalId) };
      }
      default:
        this.logger.log({ event: 'qbo_invoice_update_requested' });
        const snapshot = await this.qboInvoices.updateInvoice({ ...internal, externalId: qbo.externalId }, qbo.version);
        this.logger.log({ event: 'qbo_invoice_update_succeeded' });
        return { action: SYNC_ACTION.UPDATED_QBO, snapshot: await this.qboInvoices.getInvoice(snapshot.externalId) };
    }
  }

  private async syncQboInvoice(job: SyncJobEntity, sourceSnapshot?: InvoiceSnapshot): Promise<void> {
    const qbo = sourceSnapshot ?? (await this.qboInvoices.getInvoice(job.entityId));
    let link = await this.sync.findLinkByQbo(qbo.externalId);
    const internal = link
      ? await this.internal.getSnapshot(link.internalInvoiceId)
      : await this.internal.findSnapshotByNumber(qbo.number);

    if (!internal) {
      await this.persistQboUpdate(job, qbo, undefined, undefined, { action: SYNC_ACTION.CREATED_INTERNAL });
      return;
    }
    link ??= await this.link(internal, qbo);
    if (this.concurrentChange(link, internal, qbo)) {
      await this.sync.conflict(job, link, internal, qbo);
      return;
    }
    if (!this.changed(internal, qbo)) {
      await this.complete(job, internal, qbo, link, {
        action: SYNC_ACTION.ALREADY_SYNCHRONIZED,
        internalInvoiceId: internal.externalId,
      });
      return;
    }
    await this.persistQboUpdate(job, qbo, internal, link, {
      action: SYNC_ACTION.UPDATED_INTERNAL,
      internalInvoiceId: internal.externalId,
    });
  }

  private async syncQboDeletion(job: SyncJobEntity): Promise<void> {
    const link = await this.sync.findLinkByQbo(job.entityId);
    if (!link) {
      await this.sync.done(job, { action: SYNC_ACTION.IGNORED_DELETED_QBO_WITHOUT_LINK });
      return;
    }

    const internal = await this.internal.getSnapshot(link.internalInvoiceId);
    const deletedQbo = this.deletedQboSnapshot(this.lastQboSnapshot(link, internal));
    if (internal.status === INVOICE_STATUS.DELETED) {
      await this.complete(job, internal, deletedQbo, link, {
        action: SYNC_ACTION.ALREADY_DELETED_INTERNAL,
        internalInvoiceId: internal.externalId,
      });
      return;
    }
    if (this.internalChangedSinceLastSync(link, internal)) {
      await this.sync.conflict(job, link, internal, deletedQbo);
      return;
    }

    await this.db.transaction(async (manager) => {
      const deletedInternal = await this.internal.markDeletedFromQboInTransaction(manager, internal);
      await this.sync.completeWithLinkInTransaction(manager, job, this.linkData(deletedInternal, deletedQbo, link), {
        action: SYNC_ACTION.DELETED_INTERNAL_FROM_QBO,
        internalInvoiceId: deletedInternal.externalId,
      });
    });
  }

  private async persistQboUpdate(
    job: SyncJobEntity,
    qbo: InvoiceSnapshot,
    existingInternal: InvoiceSnapshot | undefined,
    existingLink: InvoiceLinkEntity | undefined,
    details: CompletionDetails,
  ): Promise<void> {
    await this.db.transaction(async (manager) => {
      const internal = await this.internal.upsertFromQboInTransaction(manager, qbo, existingInternal);
      await this.sync.completeWithLinkInTransaction(manager, job, this.linkData(internal, qbo, existingLink), {
        ...details,
        internalInvoiceId: internal.externalId,
      });
    });
  }

  private linkData(
    internal: InvoiceSnapshot,
    qbo: InvoiceSnapshot,
    existing?: InvoiceLinkEntity,
  ): Partial<InvoiceLinkEntity> {
    return {
      id: existing?.id,
      internalInvoiceId: internal.externalId,
      qboInvoiceId: qbo.externalId,
      qboSyncToken: qbo.version,
      lastInternalSnapshot: storeInvoiceSnapshot(internal),
      lastQboSnapshot: storeInvoiceSnapshot(qbo),
      lastSyncedAt: new Date(),
    };
  }

  private link(internal: InvoiceSnapshot, qbo: InvoiceSnapshot): Promise<InvoiceLinkEntity> {
    return this.sync.saveLink(this.linkData(internal, qbo));
  }

  private async complete(
    job: SyncJobEntity,
    internal: InvoiceSnapshot,
    qbo: InvoiceSnapshot,
    existing: InvoiceLinkEntity | undefined,
    details: CompletionDetails,
  ): Promise<InvoiceLinkEntity> {
    const link = await this.sync.completeWithLink(job, this.linkData(internal, qbo, existing), details);
    this.logJob('sync_job_completed', job, { action: details.action });
    return link;
  }

  private async resolveInvoiceLease(job: SyncJobEntity): Promise<InvoiceLeaseResolution> {
    const link =
      job.source === SYNC_SOURCE.INTERNAL
        ? await this.sync.findLinkByInternal(job.entityId)
        : await this.sync.findLinkByQbo(job.entityId);
    if (link) return { key: `invoice:internal:${link.internalInvoiceId}` };
    if (job.source === SYNC_SOURCE.QBO && job.operation === SYNC_OPERATION.DELETE) {
      return { key: `invoice:qbo:${job.entityId}` };
    }

    const sourceSnapshot =
      job.source === SYNC_SOURCE.INTERNAL
        ? await this.internal.getSnapshot(job.entityId)
        : await this.qboInvoices.getInvoice(job.entityId);
    return { key: this.invoiceNumberLeaseKey(sourceSnapshot.number), sourceSnapshot };
  }

  private async handleProcessingError(job: SyncJobEntity, error: unknown, stage: string): Promise<void> {
    const details = errorDetails(error);
    if (error instanceof DependencyUnavailableError) {
      this.logger.warn({ event: 'sync_job_waiting_for_dependency', ...this.jobLogContext(job), stage, ...details });
      await this.sync.waitForDependency(job, details.code);
      return;
    }
    this.logger.warn({ event: 'sync_job_processing_failed', ...this.jobLogContext(job), stage, ...details });
    if (isRetryable(error)) await this.sync.retry(job, error);
    else await this.sync.fail(job, error);
  }

  private logJob(event: string, job: SyncJobEntity, details: object = {}): void {
    this.logger.log({ event, ...this.jobLogContext(job), ...details });
  }

  private logPollingFailure(error: unknown): void {
    this.logger.error({ event: 'sync_worker_polling_failed', ...errorDetails(error) });
  }

  private jobLogContext(job: SyncJobEntity): {
    jobId: string;
    source: string;
    entityType: string;
    operation: string;
    attempts: number;
  } {
    return {
      jobId: job.id,
      source: job.source,
      entityType: job.entityType,
      operation: job.operation,
      attempts: job.attempts,
    };
  }

  private async releaseEntityLease(lease: EntityLease): Promise<void> {
    try {
      await this.sync.releaseEntityLease(lease.key, lease.owner);
    } catch {
      this.logger.error({ event: 'sync_entity_lease_release_failed' });
    }
  }

  private concurrentChange(link: InvoiceLinkEntity, internal: InvoiceSnapshot, qbo: InvoiceSnapshot): boolean {
    return this.internalChangedSinceLastSync(link, internal) && this.qboChangedSinceLastSync(link, qbo);
  }

  private internalChangedSinceLastSync(link: InvoiceLinkEntity, internal: InvoiceSnapshot): boolean {
    return Boolean(link.lastInternalSnapshot && this.changed(readInvoiceSnapshot(link.lastInternalSnapshot), internal));
  }

  private qboChangedSinceLastSync(link: InvoiceLinkEntity, qbo: InvoiceSnapshot): boolean {
    // SyncToken is QuickBooks' optimistic-concurrency version. It is more reliable
    // than comparing its representation of money or provider-managed fields.
    if (link.qboSyncToken) return link.qboSyncToken !== qbo.version;
    return Boolean(link.lastQboSnapshot && this.changed(readInvoiceSnapshot(link.lastQboSnapshot), qbo));
  }

  private invoiceNumberLeaseKey(number: string): string {
    return `invoice:number:${number.trim().toUpperCase()}`;
  }

  private lastQboSnapshot(link: InvoiceLinkEntity, fallback: InvoiceSnapshot): InvoiceSnapshot {
    if (link.lastQboSnapshot) return readInvoiceSnapshot(link.lastQboSnapshot);
    return { ...fallback, source: SYNC_SOURCE.QBO, externalId: link.qboInvoiceId, version: link.qboSyncToken };
  }

  private deletedQboSnapshot(qbo: InvoiceSnapshot): InvoiceSnapshot {
    return { ...qbo, status: INVOICE_STATUS.DELETED };
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof ExternalServiceError && error.statusCode === 404;
  }

  private changed(before: InvoiceSnapshot, after: InvoiceSnapshot): boolean {
    return !isDeepStrictEqual(comparableInvoice(before), comparableInvoice(after));
  }
}

function comparableInvoice(invoice: InvoiceSnapshot): ComparableInvoice {
  return {
    number: invoice.number,
    customerRef: invoice.customerRef,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    total: canonicalDecimal(invoice.total),
    balance: canonicalDecimal(invoice.balance),
    status: invoice.status,
    lines: invoice.lines.map((line) => ({
      description: line.description,
      amount: canonicalDecimal(line.amount),
      qboItemRef: line.qboItemRef,
      ...(line.quantity === undefined ? {} : { quantity: canonicalDecimal(line.quantity) }),
    })),
  };
}

function canonicalDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const canonicalWhole = whole.replace(/^(-?)0+(?=\d)/, '$1');
  const canonicalFraction = fraction.replace(/0+$/, '');
  return canonicalFraction ? `${canonicalWhole}.${canonicalFraction}` : canonicalWhole;
}
