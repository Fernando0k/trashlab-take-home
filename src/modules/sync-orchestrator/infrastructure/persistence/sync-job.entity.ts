import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SyncEntityType, SyncJobStatus, SyncOperation, SyncSource } from '../../domain/sync-values';

@Entity('sync_jobs')
@Index(['dedupeKey'], { unique: true })
export class SyncJobEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() dedupeKey: string;
  @Column() source: SyncSource;
  @Column() entityType: SyncEntityType;
  @Column() entityId: string;
  @Column() operation: SyncOperation;
  @Column({ type: 'jsonb', nullable: true }) payload?: object;
  @Column({ default: 'PENDING' }) status: SyncJobStatus;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }) runAfter: Date;
  @Column({ type: 'timestamptz', nullable: true }) lockedAt: Date | null;
  @Column({ type: 'text', nullable: true }) lastError?: string;
  @Column({ type: 'uuid', nullable: true }) conflictId?: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
