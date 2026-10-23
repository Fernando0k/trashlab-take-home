import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  response.locals.requestId = suppliedRequestId(request) ?? randomUUID();
  response.setHeader(REQUEST_ID_HEADER, response.locals.requestId);
  next();
}

export function requestId(response: Response): string {
  return response.locals?.requestId ?? randomUUID();
}

function suppliedRequestId(request: Request): string | undefined {
  const value = request.headers[REQUEST_ID_HEADER];
  if (typeof value !== 'string') return undefined;
  return /^[a-zA-Z0-9-]{1,128}$/.test(value) ? value : undefined;
}
