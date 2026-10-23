import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { QboConnectionStatus } from '../../domain/qbo-connection';

@Entity('qbo_connections')
export class QboConnectionEntity {
  @PrimaryColumn() realmId: string;
  @Column({ type: 'text' }) encryptedAccessToken: string;
  @Column({ type: 'text' }) encryptedRefreshToken: string;
  @Column({ type: 'timestamptz' }) accessTokenExpiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) refreshTokenExpiresAt: Date | null;
  @Column({ type: 'int', default: 1 }) tokenVersion: number;
  @Column({ type: 'varchar', nullable: true }) refreshLeaseOwner: string | null;
  @Column({ type: 'timestamptz', nullable: true }) refreshLeaseExpiresAt: Date | null;
  @Column({ default: 'ACTIVE' }) status: QboConnectionStatus;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
