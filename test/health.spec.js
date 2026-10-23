const { ServiceUnavailableException } = require('@nestjs/common');
const { HealthController } = require('../dist/shared/health/health.controller');
const { ReadinessService } = require('../dist/shared/health/readiness.service');

describe('in-memory health endpoints', () => {
  it('becomes ready only after the already-initialized TypeORM datasource has bootstrapped', () => {
    const readiness = new ReadinessService({ isInitialized: true });
    const controller = new HealthController(readiness);

    expect(controller.live()).toEqual({ status: 'ok' });
    expect(() => controller.ready()).toThrow(ServiceUnavailableException);

    readiness.onApplicationBootstrap();

    expect(controller.ready()).toEqual({ status: 'ok' });
  });

  it('is marked unready before graceful shutdown without querying PostgreSQL', () => {
    const database = { isInitialized: true };
    const readiness = new ReadinessService(database);
    const controller = new HealthController(readiness);
    readiness.onApplicationBootstrap();

    readiness.beforeApplicationShutdown();

    expect(() => controller.ready()).toThrow(ServiceUnavailableException);
    expect(database).toEqual({ isInitialized: true });
  });
});
