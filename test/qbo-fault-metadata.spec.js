const { qboFaultMetadata } = require('../dist/modules/qbo-integration/infrastructure/qbo-fault-metadata');

describe('qboFaultMetadata', () => {
  it('keeps only safe QBO fault identifiers', () => {
    const metadata = qboFaultMetadata(
      JSON.stringify({
        Fault: {
          type: 'ValidationFault',
          Error: [{ code: '2500', Message: 'PII must not be retained', Detail: 'secret customer detail' }],
        },
      }),
    );

    expect(metadata).toEqual({ providerCode: '2500', providerFaultType: 'ValidationFault' });
    expect(JSON.stringify(metadata)).not.toContain('secret customer detail');
  });

  it('drops malformed or unsafe values', () => {
    expect(qboFaultMetadata('{"Fault":{"type":"Validation Fault!","Error":[{"code":"2500 x"}]}}')).toEqual({});
  });
});
