/** Builds an HTTP Basic authorization value without coupling callers to a provider. */
export function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}
