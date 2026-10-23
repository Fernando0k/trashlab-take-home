# Two-way QBO invoice sync

A small NestJS service that synchronizes invoices between an internal invoice API
and a real QuickBooks Online sandbox. It uses the QBO Accounting REST API through
Undici connection pools; no SDK hides external-write or retry behavior.

Built as a take-home exercise for [TrashLab](https://trashlab.com/), waste-hauler
operations software with accounting integrations.

<p align="center">
  <a href="https://trashlab.com/">
    <img src="assets/trashlab-logo.png" alt="TrashLab" width="180" />
  </a>
</p>

## What is implemented

- Internal-to-QBO and QBO-to-internal invoice creation and updates.
- QBO webhook ingestion, durable idempotent jobs, retries, and audit records.
- Conflict detection based on the internal snapshot and QBO's authoritative
  `SyncToken`.
- Distinct QBO void and delete behavior, retained internally as `VOID` and
  `DELETED` terminal states.
- QBO Payment events persist payment details and invoice allocations, then
  reconcile each affected invoice's balance and status.
- Intuit OAuth, encrypted shared tokens, and cross-replica token refresh leasing.

Invoice and QBO-to-internal payment data are the intentionally limited take-home
scope. The [design tradeoffs](./DESIGN.md#deliberate-scope-boundary) explain why
internal-to-QBO payment creation, account mapping, and general-ledger
synchronization are intentionally out of scope.

## Prerequisites

- Node.js 24.22.0, selected with `nvm use` from [.nvmrc](.nvmrc).
- pnpm 12.14.0.
- Docker Desktop for local PostgreSQL.
- An Intuit developer account and QBO sandbox for a real external sync.

## Local quickstart

1. Create the environment file and generate independent API keys.

   ```bash
   cp .env.example .env
   openssl rand -base64 32 # INTERNAL_API_KEY
   openssl rand -base64 32 # QBO_SETUP_API_KEY
   openssl rand -base64 32 # QBO_TOKEN_ENCRYPTION_KEY
   ```

   Put the generated values in `.env`. The service will not start without all
   required secrets.

2. Install the exact locked dependency set, start PostgreSQL, and run the single
   baseline migration.

   ```bash
   nvm use
   pnpm install --frozen-lockfile
   docker compose up -d postgres
   pnpm run migration:run
   ```

3. Start the compiler and application watcher:

   ```bash
   pnpm run start:dev
   ```

4. Open the API documentation at `http://localhost:3000/docs`.

`pnpm install` is frozen by workspace policy: it fails on manifest/lockfile
drift instead of rewriting `pnpm-lock.yaml`. Dependency upgrades are intentional
changes: update the catalog range or version, regenerate the lockfile, review it,
then commit both files. Releases must be at least seven days old; see
[pnpm-workspace.yaml](pnpm-workspace.yaml).

`start:dev` uses `concurrently` to keep the TypeScript compiler and Node runtime
in one terminal. Stop and restart it after changing `.env`, because configuration
is read during application startup.

## Connect a QBO sandbox

1. Create an [Intuit Developer account](https://developer.intuit.com/) and a
   QuickBooks Online sandbox company.
2. Create a development app with Accounting scope and add
   `http://localhost:3000/v1/qbo/oauth/callback` as its redirect URI.
3. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, and the generated
   `QBO_WEBHOOK_VERIFIER_TOKEN` in `.env`.
4. Configure a public HTTPS webhook URL at
   `https://YOUR-TUNNEL/v1/qbo/webhook` in Intuit. A tunnel is appropriate for
   local development only. In the Development webhook subscription, enable the
   CloudEvents payload format and subscribe to Invoice create, update, delete,
   void, and Payment create/update/delete/void events.
5. Start OAuth with its dedicated setup key, open the returned redirect URL, and
   authorize the sandbox company.

   ```bash
   curl -i http://localhost:3000/v1/qbo/oauth/start \
     -H "x-qbo-setup-key: $QBO_SETUP_API_KEY"
   ```

The callback stores encrypted access and refresh tokens in PostgreSQL. Do not put
tokens in `.env`. Create a sandbox customer and sales item before creating an
invoice: `customerRef` and `qboItemRef` are their QBO IDs. The item determines
the income account for this take-home. Intuit's [Account API explorer](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account)
helps inspect account records. The webhook endpoint accepts the current
CloudEvents payload (including Intuit's single-event dashboard test) and the
legacy payload during migration; its safe queued-event log entry is
`qbo_webhook_queued`.
It retains the original body bytes regardless of the provider's content type so
the Intuit HMAC can be verified correctly.

## Verify the invoice sync

Start `pnpm run start:dev`, complete OAuth, and use a real QBO sandbox customer
and sales item. The examples below use customer `58` and item `19`; replace
them with IDs from your own sandbox. Each write is asynchronous: wait for the
worker log event `sync_job_processing_finished` before checking QBO.

### 1. Create an invoice

Create an internal invoice after OAuth succeeds. Save the returned `id` as
`INVOICE_ID` for the update, void, or delete examples.

```bash
curl -X POST http://localhost:3000/v1/internal/invoices \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"number":"INV-1001","customerRef":"58","issueDate":"2026-10-16","total":"100.00","lines":[{"description":"Consulting","amount":"100.00","qboItemRef":"19","quantity":"1"}]}'
```

The worker creates the QBO invoice on its configured poll interval, refetches
the result, and stores the canonical snapshot and QBO `SyncToken` in
`invoice_links`.

### 2. Update an invoice

Use the internal UUID returned from the create response to update both the
invoice total and its line consistently:

```bash
export INVOICE_ID='replace-with-the-internal-invoice-uuid'
curl -X PATCH "http://localhost:3000/v1/internal/invoices/$INVOICE_ID" \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"total":"120.00","lines":[{"description":"Garden supplies, updated","amount":"120.00","qboItemRef":"19","quantity":"1"}]}'
```

### 3. Void an invoice

Voiding retains the internal invoice and voids its linked QBO transaction. It
does not delete either record.

```bash
curl -X PATCH "http://localhost:3000/v1/internal/invoices/$INVOICE_ID" \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"status":"VOID"}'
```

The expected terminal audit action is `voided_qbo`. A `VOID` invoice cannot be
edited or deleted. Use a separate `OPEN` invoice for the deletion check.

### 4. Delete an invoice

Deleting sends the QBO delete operation and retains an internal `DELETED`
tombstone; it does not physically delete the internal record. QBO can reject a
delete when its accounting rules do not allow the transaction to be deleted, so
use a newly created, unpaid invoice for this check.

```bash
export INVOICE_ID='replace-with-a-separate-open-internal-invoice-uuid'
curl -X PATCH "http://localhost:3000/v1/internal/invoices/$INVOICE_ID" \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"status":"DELETED"}'
```

The expected terminal audit action is `deleted_qbo`. A `DELETED` invoice cannot
be edited, voided, or restored through this API.

### 5. Stress-test creation

This creates unique internal invoices concurrently and queues real QBO work. It
requires explicit confirmation and never prints invoice bodies, keys, or
provider responses.

```bash
export STRESS_CREATE_CONFIRM=yes
export STRESS_QBO_CUSTOMER_REF=58
export STRESS_QBO_ITEM_REF=19
export STRESS_CREATE_COUNT=25
export STRESS_CREATE_CONCURRENCY=5
pnpm run stress:create
```

`STRESS_CREATE_COUNT` is capped at 1000 and concurrency at 20. The default
target is `http://localhost:$APP_PORT`; set `STRESS_BASE_URL` to use another
local target. Every accepted request creates a real sandbox invoice when the
worker processes it.

### 6. Stress-test updates

Run this only with explicit `OPEN` internal invoice IDs. It updates every listed
invoice to the same amount and line content, then queues the corresponding QBO
updates. It intentionally requires the IDs: it never discovers or modifies
arbitrary sandbox invoices. Use IDs returned by the create endpoint above (or
IDs selected deliberately from `internal_invoices`). It prints only a
success/failure summary and exits non-zero if any request fails.

```bash
export STRESS_UPDATE_CONFIRM=yes
export STRESS_QBO_ITEM_REF=19
export STRESS_INTERNAL_INVOICE_IDS='uuid-1,uuid-2,uuid-3'
export STRESS_UPDATE_AMOUNT=2.00
export STRESS_UPDATE_CONCURRENCY=5
pnpm run stress:update
```

Inspect `sync_jobs`, `sync_entity_leases`, `sync_audit_log`, `invoice_links`,
and `sync_conflicts` to observe processing. Conflicts are retained for review;
they are not automatically retried or overwritten.

## Development commands

| Command                  | Purpose                               |
| ------------------------ | ------------------------------------- |
| `pnpm run build`         | Compile TypeScript.                   |
| `pnpm run start:dev`     | Run the compiler and Node watchers.   |
| `pnpm run watch:tsc`     | Recompile TypeScript source.          |
| `pnpm run watch:node`    | Restart Node when `dist/` changes.    |
| `pnpm run stress:create` | Create concurrent real test invoices. |
| `pnpm run stress:update` | Update concurrent real test invoices. |
| `pnpm test`              | Build and run the Vitest suite.       |
| `pnpm run lint`          | Run Oxlint with warnings denied.      |
| `pnpm run format:check`  | Check Prettier formatting.            |
| `pnpm run migration:run` | Apply compiled TypeORM migrations.    |

## Runtime endpoints

| Endpoint                  | Purpose                              | Authentication       |
| ------------------------- | ------------------------------------ | -------------------- |
| `/docs`                   | OpenAPI UI                           | None                 |
| `/v1/health/live`         | Process liveness                     | None                 |
| `/v1/health/ready`        | In-memory startup/shutdown readiness | None                 |
| `/v1/internal/invoices/*` | Internal invoice API                 | `x-internal-api-key` |
| `/v1/qbo/oauth/start`     | Start Intuit OAuth                   | `x-qbo-setup-key`    |
| `/v1/qbo/webhook`         | Receive Intuit changes               | Intuit HMAC only     |

Health endpoints do not query PostgreSQL or create connections. Migration
execution belongs in a deployment pipeline or dedicated Job before application
pods roll out. Database/QBO outages, conflicts, and job backlog are operational
alerts, not reasons to restart healthy pods.

The service is designed as an HPA-ready Deployment: PostgreSQL owns job claims,
entity leases, idempotency keys, and QBO token coordination; individual pods
keep only bounded connection pools and a short-lived access-token cache. See
[HPA-ready Kubernetes deployment](./DESIGN.md#hpa-ready-kubernetes-deployment)
for the autoscaling, capacity, and correctness tradeoffs.

## Further reading

- [Design and tradeoffs](./DESIGN.md): sync behavior, diagrams, idempotency,
  conflicts, OAuth lifecycle, and deliberate limitations.
- [Architecture](./ARCHITECTURE.md): module boundaries, dependency direction,
  persistence ownership, security, schema evolution, and extraction path.
