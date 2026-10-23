import { timingSafeEqual } from 'node:crypto';

/** Constant-time comparison for credentials of the same type. */
export function matchesSecret(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const actual = Buffer.from(received);
  const secret = Buffer.from(expected);
  return actual.length === secret.length && timingSafeEqual(actual, secret);
}
