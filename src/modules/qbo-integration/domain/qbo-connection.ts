export const QBO_CONNECTION_STATUSES = ['ACTIVE', 'REAUTH_REQUIRED'] as const;
export type QboConnectionStatus = (typeof QBO_CONNECTION_STATUSES)[number];
