import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { InvoiceLinkEntity } from './persistence/invoice-link.entity';
import { SyncAuditEntity } from './persistence/sync-audit.entity';
import { SyncConflictEntity } from './persistence/sync-conflict.entity';
import { SyncJobEntity } from './persistence/sync-job.entity';
import { errorDetails } from '../../../shared/errors/application-error';
import { InvoiceSnapshot } from '../../invoicing/domain/invoice';
import { readInvoiceSnapshot, storeInvoiceSnapshot } from '../domain/versioned-json';
import { AppConfig } from '../../../shared/config/app-config.service';
import { SyncEntityLeaseEntity } from './persistence/sync-entity-lease.entity';

@Injectable()
export class SyncRepository {
  constructor(
    private readonly db: DataSource,
    private readonly config: AppConfig,
    @InjectRepository(InvoiceLinkEntity) private readonly links: Repository<InvoiceLinkEntity>,
    @InjectRepository(SyncEntityLeaseEntity) private readonly entityLeases: Repository<SyncEntityLeaseEntity>,
  ) {}
  async enqueue(
    job: Omit<Pick<SyncJobEntity, 'dedupeKey' | 'source' | 'entityType' | 'entityId' | 'operation'>, 'payload'> & {
      payload?: object;
    },
  ): Promise<void> {
    await this.insertJob(this.db, job);
  }
  async enqueueInTransaction(
    manager: EntityManager,
    job: Omit<Pick<SyncJobEntity, 'dedupeKey' | 'source' | 'entityType' | 'entityId' | 'operation'>, 'payload'> & {
      payload?: object;
    },
  ): Promise<void> {
    await this.insertJob(manager, job);
  }
  private async insertJob(
    executor: DataSource | EntityManager,
    job: Omit<Pick<SyncJobEntity, 'dedupeKey' | 'source' | 'entityType' | 'entityId' | 'operation'>, 'payload'> & {
      payload?: object;
    },
  ): Promise<void> {
    await executor
      .getRepository(SyncJobEntity)
      .createQueryBuilder()
      .insert()
      .into(SyncJobEntity)
      .values(job)
      .orIgnore()
      .execute();
  }
  async claim(): Promise<SyncJobEntity | null> {
    const now = new Date();
    const abandonedBefore = new Date(Date.now() - this.config.app.sync.jobLeaseMs);
    return this.db.transaction(async (manager) => {
      const job = await manager.findOne(SyncJobEntity, {
        where: [
          { status: 'PENDING', runAfter: LessThanOrEqual(now) },
          { status: 'PROCESSING', lockedAt: IsNull() },
          { status: 'PROCESSING', lockedAt: LessThan(abandonedBefore) },
        ],
        order: { runAfter: 'ASC' },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
      if (!job) return null;

      job.status = 'PROCESSING';
      job.lockedAt = now;
      return manager.save(job);
    });
  }
  findLinkByInternal(id: string): Promise<InvoiceLinkEntity | null> {
    return this.links.findOneBy({ internalInvoiceId: id });
  }
  findLinkByQbo(id: string): Promise<InvoiceLinkEntity | null> {
    return this.links.findOneBy({ qboInvoiceId: id });
  }
  saveLink(link: Partial<InvoiceLinkEntity>): Promise<InvoiceLinkEntity> {
    return this.links.save(this.links.create(link));
  }
  async completeWithLink(
    job: SyncJobEntity,
    link: Partial<InvoiceLinkEntity>,
    details: object,
  ): Promise<InvoiceLinkEntity> {
    return this.db.transaction((manager) => this.completeWithLinkInTransaction(manager, job, link, details));
  }
  async completeWithLinkInTransaction(
    manager: EntityManager,
    job: SyncJobEntity,
    link: Partial<InvoiceLinkEntity>,
    details: object,
  ): Promise<InvoiceLinkEntity> {
    const savedLink = await manager.save(InvoiceLinkEntity, manager.create(InvoiceLinkEntity, link));
    await manager.update(SyncJobEntity, job.id, { status: 'DONE', lockedAt: null });
    await this.writeAudit(manager, job, 'sync_succeeded', details);
    return savedLink;
  }
  async done(job: SyncJobEntity, details: object): Promise<void> {
    await this.db.transaction((manager) => this.doneInTransaction(manager, job, details));
  }
  async doneInTransaction(manager: EntityManager, job: SyncJobEntity, details: object): Promise<void> {
    await manager.update(SyncJobEntity, job.id, { status: 'DONE', lockedAt: null });
    await this.writeAudit(manager, job, 'sync_succeeded', details);
  }
  async retry(job: SyncJobEntity, error: unknown): Promise<void> {
    const attempts = job.attempts + 1;
    const details = errorDetails(error);
    const exhausted = attempts >= this.config.app.sync.maxRetries;
    await this.db.transaction(async (manager) => {
      await manager.update(SyncJobEntity, job.id, {
        status: exhausted ? 'FAILED' : 'PENDING',
        attempts,
        lockedAt: null,
        runAfter: new Date(
          Date.now() +
            Math.min(this.config.app.sync.retryMaxDelayMs, this.config.app.sync.retryBaseDelayMs * 2 ** attempts),
        ),
        lastError: details.code,
      });
      await this.writeAudit(manager, job, exhausted ? 'sync_failed' : 'sync_retry_scheduled', { ...details, attempts });
    });
  }
  async defer(job: SyncJobEntity, reason: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager.update(SyncJobEntity, job.id, {
        status: 'PENDING',
        lockedAt: null,
        runAfter: new Date(Date.now() + this.config.app.sync.entityLeaseRetryDelayMs),
      });
      await this.writeAudit(manager, job, 'sync_deferred', { reason });
    });
  }
  async waitForDependency(job: SyncJobEntity, code: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager.update(SyncJobEntity, job.id, {
        status: 'PENDING',
        lockedAt: null,
        runAfter: new Date(Date.now() + this.config.app.sync.dependencyRetryDelayMs),
        lastError: code,
      });
      await this.writeAudit(manager, job, 'sync_waiting_for_dependency', { code });
    });
  }
  async acquireEntityLease(entityKey: string, owner: string): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.app.sync.entityLeaseMs);
    const inserted = await this.entityLeases
      .createQueryBuilder()
      .insert()
      .into(SyncEntityLeaseEntity)
      .values({ entityKey, owner, expiresAt })
      .orIgnore()
      .returning('"entityKey"')
      .execute();
    if (inserted.identifiers.length > 0) return true;

    const reclaimed = await this.entityLeases.update({ entityKey, expiresAt: LessThan(now) }, { owner, expiresAt });
    return Boolean(reclaimed.affected);
  }
  async releaseEntityLease(entityKey: string, owner: string): Promise<void> {
    await this.entityLeases.delete({ entityKey, owner });
  }
  async fail(job: SyncJobEntity, error: unknown): Promise<void> {
    const details = errorDetails(error);
    await this.db.transaction(async (manager) => {
      await manager.update(SyncJobEntity, job.id, {
        status: 'FAILED',
        attempts: job.attempts + 1,
        lockedAt: null,
        lastError: details.code,
      });
      await this.writeAudit(manager, job, 'sync_failed', details);
    });
  }
  async conflict(
    job: SyncJobEntity,
    link: InvoiceLinkEntity,
    internalSnapshot: InvoiceSnapshot,
    qboSnapshot: InvoiceSnapshot,
  ): Promise<void> {
    const baseSnapshot = link.lastInternalSnapshot ? readInvoiceSnapshot(link.lastInternalSnapshot) : internalSnapshot;
    await this.db.transaction(async (manager) => {
      const conflict = await manager.save(
        SyncConflictEntity,
        manager.create(SyncConflictEntity, {
          internalInvoiceId: link.internalInvoiceId,
          qboInvoiceId: link.qboInvoiceId,
          baseSnapshot: storeInvoiceSnapshot(baseSnapshot),
          internalSnapshot: storeInvoiceSnapshot(internalSnapshot),
          qboSnapshot: storeInvoiceSnapshot(qboSnapshot),
        }),
      );
      await manager.update(SyncJobEntity, job.id, { status: 'CONFLICT', conflictId: conflict.id, lockedAt: null });
      await this.writeAudit(manager, job, 'conflict_detected', { conflictId: conflict.id });
    });
  }
  private async writeAudit(manager: EntityManager, job: SyncJobEntity, action: string, details: object): Promise<void> {
    await manager.insert(SyncAuditEntity, {
      jobId: job.id,
      action,
      entityType: job.entityType,
      entityId: job.entityId,
      details,
    });
  }
}
