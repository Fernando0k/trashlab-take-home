import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { StoredInvoiceSnapshot } from '../../domain/versioned-json';

@Entity('invoice_links')
@Index(['internalInvoiceId'], { unique: true })
@Index(['qboInvoiceId'], { unique: true })
export class InvoiceLinkEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') internalInvoiceId: string;
  @Column() qboInvoiceId: string;
  @Column() qboSyncToken: string;
  @Column({ type: 'jsonb', nullable: true }) lastInternalSnapshot?: StoredInvoiceSnapshot;
  @Column({ type: 'jsonb', nullable: true }) lastQboSnapshot?: StoredInvoiceSnapshot;
  @Column({ type: 'timestamptz', nullable: true }) lastSyncedAt?: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
