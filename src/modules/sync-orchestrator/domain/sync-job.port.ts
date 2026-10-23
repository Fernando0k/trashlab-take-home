import { SyncJobEntity } from '../infrastructure/persistence/sync-job.entity';
import { EntityManager } from 'typeorm';

export const SYNC_JOB_PORT = Symbol('SYNC_JOB_PORT');

export interface SyncJobPort {
  enqueue(
    job: Omit<Pick<SyncJobEntity, 'dedupeKey' | 'source' | 'entityType' | 'entityId' | 'operation'>, 'payload'> & {
      payload?: object;
    },
  ): Promise<void>;
  enqueueInTransaction(
    manager: EntityManager,
    job: Omit<Pick<SyncJobEntity, 'dedupeKey' | 'source' | 'entityType' | 'entityId' | 'operation'>, 'payload'> & {
      payload?: object;
    },
  ): Promise<void>;
}
