const { matchesSecret } = require('../dist/shared/auth/secret-match');
const { QboWebhookGuard } = require('../dist/modules/qbo-integration/api/qbo-webhook.guard');
const { createHmac } = require('node:crypto');

describe('service authentication', () => {
  it('accepts only the exact credential', () => {
    expect(matchesSecret('correct-key', 'correct-key')).toBe(true);
    expect(matchesSecret('wrong-key', 'correct-key')).toBe(false);
    expect(matchesSecret(undefined, 'correct-key')).toBe(false);
  });

  it('accepts a valid Intuit HMAC over the unmodified request body', () => {
    const verifierToken = 'webhook-verifier-token';
    const rawBody = Buffer.from('[{"type":"qbo.invoice.updated.v1"}]');
    const signature = createHmac('sha256', verifierToken).update(rawBody).digest('base64');
    const guard = new QboWebhookGuard({ secrets: { qbo: { webhookVerifierToken: verifierToken } } });
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ rawBody, headers: { 'intuit-signature': signature } }) }),
    };

    expect(guard.canActivate(context)).toBe(true);
  });
});
