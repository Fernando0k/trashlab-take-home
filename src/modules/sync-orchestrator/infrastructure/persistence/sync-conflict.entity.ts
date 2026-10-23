import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { StoredInvoiceSnapshot } from '../../domain/versioned-json';
import { SyncConflictStatus } from '../../domain/sync-values';

@Entity('sync_conflicts')
export class SyncConflictEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') internalInvoiceId: string;
  @Column() qboInvoiceId: string;
  @Column({ type: 'jsonb' }) baseSnapshot: StoredInvoiceSnapshot;
  @Column({ type: 'jsonb' }) internalSnapshot: StoredInvoiceSnapshot;
  @Column({ type: 'jsonb' }) qboSnapshot: StoredInvoiceSnapshot;
  @Column({ default: 'OPEN' }) status: SyncConflictStatus;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
