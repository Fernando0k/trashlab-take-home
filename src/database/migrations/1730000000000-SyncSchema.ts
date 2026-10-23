import { MigrationInterface, QueryRunner } from 'typeorm';
export class SyncSchema1730000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await q.query(
      `CREATE TABLE internal_invoices (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), number varchar NOT NULL UNIQUE, "customerRef" varchar NOT NULL, "issueDate" date NOT NULL, "dueDate" date, currency varchar NOT NULL DEFAULT 'USD', total numeric(18,2) NOT NULL, balance numeric(18,2) NOT NULL, status varchar NOT NULL DEFAULT 'OPEN', lines jsonb NOT NULL, version integer NOT NULL DEFAULT 1, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT internal_invoices_status_check CHECK (status IN ('OPEN', 'PAID', 'VOID', 'DELETED')))`,
    );
    await q.query(
      `CREATE TABLE invoice_links (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "internalInvoiceId" uuid NOT NULL UNIQUE, "qboInvoiceId" varchar NOT NULL UNIQUE, "qboSyncToken" varchar NOT NULL, "lastInternalSnapshot" jsonb, "lastQboSnapshot" jsonb, "lastSyncedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE TABLE sync_jobs (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "dedupeKey" varchar NOT NULL UNIQUE, source varchar NOT NULL, "entityType" varchar NOT NULL, "entityId" varchar NOT NULL, operation varchar NOT NULL, payload jsonb, status varchar NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0, "runAfter" timestamptz NOT NULL DEFAULT now(), "lockedAt" timestamptz, "lastError" text, "conflictId" uuid, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT sync_jobs_source_check CHECK (source IN ('internal', 'qbo')), CONSTRAINT sync_jobs_entity_type_check CHECK ("entityType" IN ('invoice', 'payment', 'account')), CONSTRAINT sync_jobs_operation_check CHECK (operation IN ('upsert', 'void', 'delete', 'discover')), CONSTRAINT sync_jobs_status_check CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'CONFLICT')))`,
    );
    await q.query(`CREATE INDEX sync_jobs_pending_ready_idx ON sync_jobs ("runAfter") WHERE status = 'PENDING'`);
    await q.query(`CREATE INDEX sync_jobs_processing_lease_idx ON sync_jobs ("lockedAt") WHERE status = 'PROCESSING'`);
    await q.query(
      `CREATE TABLE qbo_connections ("realmId" varchar PRIMARY KEY, "encryptedAccessToken" text NOT NULL, "encryptedRefreshToken" text NOT NULL, "accessTokenExpiresAt" timestamptz NOT NULL, "refreshTokenExpiresAt" timestamptz, "tokenVersion" integer NOT NULL DEFAULT 1, "refreshLeaseOwner" varchar, "refreshLeaseExpiresAt" timestamptz, status varchar NOT NULL DEFAULT 'ACTIVE', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT qbo_connections_status_check CHECK (status IN ('ACTIVE', 'REAUTH_REQUIRED')))`,
    );
    await q.query(
      `CREATE TABLE qbo_oauth_states ("stateHash" varchar(64) PRIMARY KEY, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(`CREATE INDEX qbo_oauth_states_expiry_idx ON qbo_oauth_states ("expiresAt")`);
    await q.query(
      `CREATE TABLE qbo_rate_limit_buckets (scope varchar NOT NULL, "subjectHash" varchar(64) NOT NULL, "windowStartedAt" timestamptz NOT NULL, hits integer NOT NULL DEFAULT 0, PRIMARY KEY (scope, "subjectHash", "windowStartedAt"))`,
    );
    await q.query(`CREATE INDEX qbo_rate_limit_buckets_expiry_idx ON qbo_rate_limit_buckets ("windowStartedAt")`);
    await q.query(
      `CREATE TABLE sync_conflicts (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "internalInvoiceId" uuid NOT NULL, "qboInvoiceId" varchar NOT NULL, "baseSnapshot" jsonb NOT NULL, "internalSnapshot" jsonb NOT NULL, "qboSnapshot" jsonb NOT NULL, status varchar NOT NULL DEFAULT 'OPEN', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT sync_conflicts_status_check CHECK (status IN ('OPEN', 'RESOLVED')))`,
    );
    await q.query(
      `CREATE TABLE sync_audit_log (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "jobId" varchar, action varchar NOT NULL, "entityType" varchar NOT NULL, "entityId" varchar NOT NULL, details jsonb, "createdAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE TABLE sync_entity_leases ("entityKey" varchar PRIMARY KEY, owner varchar NOT NULL, "expiresAt" timestamptz NOT NULL)`,
    );
    await q.query(
      `CREATE TABLE internal_payments (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "qboPaymentId" varchar NOT NULL UNIQUE, "qboSyncToken" varchar NOT NULL, "customerRef" varchar NOT NULL, "paymentDate" date NOT NULL, amount numeric(18,2) NOT NULL, "unappliedAmount" numeric(18,2) NOT NULL, "paymentMethodRef" varchar, "referenceNumber" varchar, status varchar NOT NULL DEFAULT 'ACTIVE', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT internal_payments_status_check CHECK (status IN ('ACTIVE', 'DELETED')))`,
    );
    await q.query(
      `CREATE TABLE payment_allocations (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "paymentId" uuid NOT NULL REFERENCES internal_payments(id), "qboInvoiceId" varchar NOT NULL, amount numeric(18,2) NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT payment_allocations_payment_invoice_unique UNIQUE ("paymentId", "qboInvoiceId"))`,
    );
    await q.query(`CREATE INDEX payment_allocations_qbo_invoice_idx ON payment_allocations ("qboInvoiceId")`);
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'payment_allocations',
      'internal_payments',
      'sync_entity_leases',
      'sync_audit_log',
      'sync_conflicts',
      'qbo_connections',
      'qbo_rate_limit_buckets',
      'qbo_oauth_states',
      'sync_jobs',
      'invoice_links',
      'internal_invoices',
    ])
      await q.query(`DROP TABLE IF EXISTS ${table}`);
  }
}
