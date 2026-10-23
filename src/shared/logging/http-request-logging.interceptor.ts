import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { requestId } from './request-context';

@Injectable()
export class HttpRequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpRequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ method: string; path: string }>();
    const response = http.getResponse<Response>();
    const startedAt = performance.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.log({
          event: 'http_request_completed',
          requestId: requestId(response),
          method: request.method,
          routePath: request.path,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }),
    );
  }
}
