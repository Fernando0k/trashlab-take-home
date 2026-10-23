const { QboOauthStateService } = require('../dist/modules/qbo-integration/application/qbo-oauth-state.service');
const { QboSetupRateLimitGuard } = require('../dist/modules/qbo-integration/api/qbo-setup-rate-limit.guard');

describe('QBO OAuth security', () => {
  it('persists only a state digest and consumes a state at most once', async () => {
    const states = {
      delete: vi
        .fn()
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 }),
      insert: vi.fn(),
    };
    const service = new QboOauthStateService({ app: { qbo: { oauthStateTtlMs: 60_000 } } }, states);

    const state = await service.issue();

    expect(states.insert).toHaveBeenCalledWith(expect.objectContaining({ stateHash: expect.any(String) }));
    expect(states.insert.mock.calls[0][0].stateHash).not.toContain(state);
    await expect(service.consume(state)).resolves.toBe(true);
    await expect(service.consume(state)).resolves.toBe(false);
  });

  it('returns 429 after the shared OAuth-start bucket is exhausted', async () => {
    const insert = { insert: vi.fn(), values: vi.fn(), orIgnore: vi.fn(), execute: vi.fn() };
    insert.insert.mockReturnValue(insert);
    insert.values.mockReturnValue(insert);
    insert.orIgnore.mockReturnValue(insert);
    const buckets = {
      delete: vi.fn(),
      createQueryBuilder: vi.fn(() => insert),
      increment: vi.fn().mockResolvedValue({ affected: 0 }),
    };
    const guard = new QboSetupRateLimitGuard(
      { app: { qbo: { oauthStartRateLimit: 5, oauthStartRateLimitWindowMs: 60_000 } } },
      buckets,
    );
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-qbo-setup-key': 'setup-key' } }) }),
    };

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });
    expect(buckets.increment).toHaveBeenCalledWith(expect.objectContaining({ hits: expect.anything() }), 'hits', 1);
  });
});
