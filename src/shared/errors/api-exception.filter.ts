import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ExternalServiceError, PUBLIC_ERROR_MESSAGE, PublicErrorCode } from './application-error';
import { requestId } from '../logging/request-context';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const correlationId = requestId(response);

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const publicErrorCode = safeHttpErrorCode(exception);
      const errorCode = publicErrorCode ?? `HTTP_${statusCode}`;
      this.logger.warn({
        requestId: correlationId,
        event: 'http_request_failed',
        errorCode,
        statusCode,
        routePath: request.path,
      });
      response.status(statusCode).json({
        statusCode,
        errorCode,
        message: publicMessage(statusCode, publicErrorCode),
        requestId: correlationId,
      });
      return;
    }

    if (exception instanceof ExternalServiceError) {
      const statusCode = exception.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY;
      this.logger.warn({
        requestId: correlationId,
        event: 'http_request_failed',
        errorCode: exception.code,
        retryable: exception.retryable,
        statusCode,
        routePath: request.path,
      });
      response.status(statusCode).json({
        statusCode,
        errorCode: exception.code,
        message: 'An upstream service could not process the request',
        requestId,
      });
      return;
    }

    this.logger.error({
      requestId: correlationId,
      event: 'http_request_failed',
      errorCode: 'INTERNAL_ERROR',
      routePath: request.path,
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: correlationId,
    });
  }
}

function safeHttpErrorCode(exception: HttpException): PublicErrorCode | undefined {
  const response = exception.getResponse();
  if (
    typeof response === 'object' &&
    response !== null &&
    'errorCode' in response &&
    isPublicErrorCode(response.errorCode)
  ) {
    return response.errorCode;
  }
  return undefined;
}

function publicMessage(statusCode: number, errorCode?: PublicErrorCode): string {
  if (errorCode) return PUBLIC_ERROR_MESSAGE[errorCode];
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return 'Invalid request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Resource not found';
    case HttpStatus.CONFLICT:
      return 'Request conflicts with the current resource state';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'Too many requests';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'Service temporarily unavailable';
    default:
      return 'Request could not be processed';
  }
}

function isPublicErrorCode(value: unknown): value is PublicErrorCode {
  return typeof value === 'string' && Object.hasOwn(PUBLIC_ERROR_MESSAGE, value);
}
