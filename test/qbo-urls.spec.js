const { qboAuthorizationUrl, qboQueryPath } = require('../dist/modules/qbo-integration/infrastructure/qbo-urls');

describe('QBO URL construction', () => {
  it('uses URL search parameters for the OAuth authorization redirect', () => {
    const url = new URL(
      qboAuthorizationUrl({
        authorizationEndpoint: 'https://appcenter.intuit.com/connect/oauth2',
        accountingScope: 'com.intuit.quickbooks.accounting',
        clientId: 'client id',
        redirectUri: 'https://sync.example.test/v1/qbo/oauth/callback?tenant=acme',
        state: 'state+/=',
      }),
    );

    expect(url.origin).toBe('https://appcenter.intuit.com');
    expect(url.pathname).toBe('/connect/oauth2');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client id',
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: 'https://sync.example.test/v1/qbo/oauth/callback?tenant=acme',
      state: 'state+/=',
    });
  });

  it('encodes QBO query parameters with URLSearchParams', () => {
    expect(qboQueryPath("select * from Invoice where DocNumber = 'INV 1&2'")).toContain('INV+1%262');
  });
});
