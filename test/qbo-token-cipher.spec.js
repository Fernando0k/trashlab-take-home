const { QboTokenCipher } = require('../dist/modules/qbo-integration/infrastructure/qbo-token-cipher');

describe('QboTokenCipher', () => {
  it('round-trips tokens without storing plaintext', () => {
    const cipher = new QboTokenCipher({
      secrets: { qbo: { tokenEncryptionKey: Buffer.alloc(32, 7).toString('base64') } },
    });
    const encrypted = cipher.encrypt('refresh-token');

    expect(encrypted).not.toContain('refresh-token');
    expect(cipher.decrypt(encrypted)).toBe('refresh-token');
  });
});
