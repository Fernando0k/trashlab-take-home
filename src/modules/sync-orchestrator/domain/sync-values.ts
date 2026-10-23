export const SYNC_SOURCES = ['internal', 'qbo'] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];
export const SYNC_SOURCE = {
  INTERNAL: 'internal',
  QBO: 'qbo',
} as const satisfies Record<string, SyncSource>;

export const SYNC_ENTITY_TYPES = ['invoice', 'payment', 'account'] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];
export const SYNC_ENTITY_TYPE = {
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  ACCOUNT: 'account',
} as const satisfies Record<string, SyncEntityType>;

export const SYNC_OPERATIONS = ['upsert', 'void', 'delete', 'discover'] as const;
export type SyncOperation = (typeof SYNC_OPERATIONS)[number];
export const SYNC_OPERATION = {
  UPSERT: 'upsert',
  VOID: 'void',
  DELETE: 'delete',
  DISCOVER: 'discover',
} as const satisfies Record<string, SyncOperation>;

export const SYNC_JOB_STATUSES = ['PENDING', 'PROCESSING', 'DONE', 'FAILED', 'CONFLICT'] as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number];

export const SYNC_CONFLICT_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type SyncConflictStatus = (typeof SYNC_CONFLICT_STATUSES)[number];
