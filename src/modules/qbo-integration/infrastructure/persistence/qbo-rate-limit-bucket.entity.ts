import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A shared, fixed-window limit bucket for the rare QBO connection action. */
@Entity('qbo_rate_limit_buckets')
export class QboRateLimitBucketEntity {
  @PrimaryColumn() scope: string;
  @PrimaryColumn({ length: 64 }) subjectHash: string;
  @PrimaryColumn({ type: 'timestamptz' }) windowStartedAt: Date;
  @Column({ type: 'int', default: 0 }) hits: number;
}
