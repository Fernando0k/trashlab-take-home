import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sync_audit_log')
export class SyncAuditEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true }) jobId?: string;
  @Column() action: string;
  @Column() entityType: string;
  @Column() entityId: string;
  @Column({ type: 'jsonb', nullable: true }) details?: unknown;
  @CreateDateColumn() createdAt: Date;
}
