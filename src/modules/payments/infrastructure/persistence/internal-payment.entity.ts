import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PaymentStatus } from '../../domain/payment';

@Entity('internal_payments')
@Index(['qboPaymentId'], { unique: true })
export class InternalPaymentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() qboPaymentId: string;
  @Column() qboSyncToken: string;
  @Column() customerRef: string;
  @Column({ type: 'date' }) paymentDate: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) unappliedAmount: string;
  @Column({ nullable: true }) paymentMethodRef?: string;
  @Column({ nullable: true }) referenceNumber?: string;
  @Column({ default: 'ACTIVE' }) status: PaymentStatus;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
