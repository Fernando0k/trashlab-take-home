export function qboAuthorizationUrl({
  authorizationEndpoint,
  accountingScope,
  clientId,
  redirectUri,
  state,
}: {
  authorizationEndpoint: string;
  accountingScope: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', accountingScope);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export function qboQueryPath(query: string): string {
  return `/query?${new URLSearchParams({ query }).toString()}`;
}
