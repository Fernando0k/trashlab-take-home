# Architecture

The application is a **modular monolith**: one NestJS process per pod in an
HPA-managed Deployment. Its folders and contracts follow microservice
boundaries, while dependencies inside each pod are in-process interfaces rather
than brokers, HTTP calls, or distributed transactions.

## Boundaries and dependency direction

| Boundary           | Owns                                                                             | May depend on                                                               |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Internal invoicing | Internal invoice lifecycle and API                                               | `SYNC_JOB_PORT`                                                             |
| Payments           | QBO-originated payment records and invoice allocations                           | Nothing outside its domain                                                  |
| QBO integration    | Intuit OAuth, webhook verification, QBO DTO translation, SyncToken writes        | `SYNC_JOB_PORT`, payment domain, shared HTTP/auth                           |
| Sync orchestration | Links, idempotency, jobs, retries, conflicts, audit data, payment reconciliation | `INTERNAL_INVOICE_PORT`, `INTERNAL_PAYMENT_PORT`, QBO invoice/payment ports |
| Ledger mapping     | Future account and general-ledger synchronization                                | Invoice item references in this take-home                                   |

```text
src/
  modules/
    invoicing/          API and lifecycle; exports INTERNAL_INVOICE_PORT
    payments/           QBO payment records and allocations; exports INTERNAL_PAYMENT_PORT
    qbo-integration/    OAuth, webhook, QBO adapter; exports invoice/payment ports
    sync-orchestrator/  durable jobs, conflicts, audit; exports SYNC_JOB_PORT
  shared/               generic configuration, HTTP, authorization, health
  database/             connection and migrations only
```

Ports are symbols because Nest requires a runtime injection token for an
interface; TypeScript interfaces disappear after compilation. The implementations
remain swappable without importing another module's infrastructure directly.

`QboAccountingClient` is one singleton provider exposed through both
`QBO_INVOICE_CLIENT` and `QBO_PAYMENT_CLIENT`. Consumers receive only the
operations they need while the OAuth lifecycle and Undici connection pool remain
shared.

`src/shared` only contains generic cross-cutting concerns. It has no invoice,
QBO-mapping, or persistence business rules. There is no catch-all `SharedModule`:
the configuration and HTTP modules each own their lifecycle and exports, while
simple authorization helpers are pure functions. `HealthModule` is a small,
independent feature module.

## Persistence and schema

Each domain owns its entities:

- `modules/invoicing/infrastructure/persistence` owns `internal_invoices`.
- `modules/payments/infrastructure/persistence` owns `internal_payments` and
  `payment_allocations`.
- `modules/sync-orchestrator/infrastructure/persistence` owns links, jobs,
  conflicts, and audit records.
- `database/` owns only data-source configuration and the squashed baseline
  TypeORM migration.

The queue claim uses a TypeORM pessimistic write lock with `skip_locked` in the
same transaction as its state transition. Entity-manager transactions keep an
internal invoice change and outbox job atomic, and keep final link/job/audit
updates atomic. Indexes support job scheduling, leases, link lookups, and unique
dedupe keys.

Only invoice snapshots are durable business contracts, so they use a small
versioned envelope:

```json
{
  "version": 1,
  "data": { "...": "snapshot fields" }
}
```

Readers accept legacy raw snapshots. A future snapshot change adds a reader for
the previous version before the new writer is enabled. Job payloads and audit
details are diagnostic JSON rather than inter-service contracts, so versioning
them now would add complexity without value. Centralized TypeScript string unions
and PostgreSQL `CHECK` constraints enforce invoice, job, conflict, and connection
lifecycle values at both application and database boundaries.

## Security and error boundaries

| Endpoint family           | Authentication                           | Trust boundary                        |
| ------------------------- | ---------------------------------------- | ------------------------------------- |
| `/v1/internal/invoices/*` | `InternalApiKeyGuard`                    | `INTERNAL_API_KEY`                    |
| `/v1/qbo/oauth/start`     | `QboSetupKeyGuard`                       | `QBO_SETUP_API_KEY`                   |
| `/v1/qbo/oauth/callback`  | Signed, time-limited OAuth state         | Intuit callback and QBO client secret |
| `/v1/qbo/webhook`         | `QboWebhookGuard` verifies raw-body HMAC | `QBO_WEBHOOK_VERIFIER_TOKEN`          |

Credentials are scoped and never reused. Configuration validates normal settings
and secrets at startup; Kubernetes may source them from ConfigMaps and external
Secrets, but the application keeps their schemas distinct. The QBO client
credentials and token-encryption key are never logged or persisted in plaintext.

Infrastructure adapters expose stable error code, category, retryability, and
upstream status. The global error filter returns a safe response with a request
ID. Raw exceptions, causes, headers, query strings, OAuth values, and customer
content do not cross the logging or persistence boundary.

## Deployment and extraction

Run migrations before admitting application pods, usually in the deployment
pipeline or a dedicated Kubernetes Job. Liveness and readiness are in-memory
checks: readiness becomes available once Nest has bootstrapped with TypeORM's
already-initialized data source and turns unavailable during graceful shutdown.
Neither probe opens a database connection.

If scale justifies physical services, extract without changing the responsibility
boundaries:

1. Publish the existing transactional invoice outbox through a broker.
2. Publish `InvoiceChanged` and `ExternalInvoiceChanged` messages.
3. Extract QBO integration first; it alone owns Intuit credentials, connection
   limits, and the webhook endpoint.
4. Keep synchronization as the sole writer of links, retry state, conflicts, and
   audit records.

This preserves the current correctness properties while avoiding distributed
transactions and network hops until they are justified.
