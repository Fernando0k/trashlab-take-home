import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A short-lived, cross-pod lease for one logical sync aggregate. */
@Entity('sync_entity_leases')
export class SyncEntityLeaseEntity {
  @PrimaryColumn() entityKey: string;
  @Column() owner: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
}
