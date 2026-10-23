import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ReadinessService } from './readiness.service';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): { status: 'ok' } {
    if (!this.readiness.isReady()) {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
