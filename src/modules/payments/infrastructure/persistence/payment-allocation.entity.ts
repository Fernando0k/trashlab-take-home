import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('payment_allocations')
@Index(['paymentId', 'qboInvoiceId'], { unique: true })
@Index(['qboInvoiceId'])
export class PaymentAllocationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') paymentId: string;
  @Column() qboInvoiceId: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
