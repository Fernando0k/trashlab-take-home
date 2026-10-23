import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { InvoiceStatus } from '../../domain/invoice';

@Entity('internal_invoices')
export class InternalInvoiceEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) number: string;
  @Column() customerRef: string;
  @Column({ type: 'date' }) issueDate: string;
  @Column({ type: 'date', nullable: true }) dueDate?: string;
  @Column({ default: 'USD' }) currency: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) total: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) balance: string;
  @Column({ default: 'OPEN' }) status: InvoiceStatus;
  @Column({ type: 'jsonb' }) lines: unknown[];
  @Column({ type: 'int', default: 1 }) version: number;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
