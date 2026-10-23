import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Stores only the SHA-256 digest of a short-lived, single-use OAuth state. */
@Entity('qbo_oauth_states')
export class QboOauthStateEntity {
  @PrimaryColumn({ length: 64 }) stateHash: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @CreateDateColumn() createdAt: Date;
}
