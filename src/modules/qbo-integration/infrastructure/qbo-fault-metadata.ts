import { ExternalErrorMetadata } from '../../../shared/errors/application-error';

type QboFault = { type?: unknown; Error?: Array<{ code?: unknown }> };
type QboFaultResponse = { Fault?: QboFault };

const SAFE_QBO_FAULT_VALUE = /^[A-Za-z0-9_-]{1,64}$/;

/** Extracts stable QBO fault identifiers without retaining user-controlled fault text. */
export function qboFaultMetadata(responseBody: string): ExternalErrorMetadata {
  try {
    const response = JSON.parse(responseBody) as QboFaultResponse;
    const fault = response.Fault;
    if (!fault) return {};
    const providerFaultType = safeFaultValue(fault.type);
    const providerCode = safeFaultValue(fault.Error?.[0]?.code);
    return {
      ...(providerCode === undefined ? {} : { providerCode }),
      ...(providerFaultType === undefined ? {} : { providerFaultType }),
    };
  } catch {
    return {};
  }
}

function safeFaultValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !SAFE_QBO_FAULT_VALUE.test(value)) return undefined;
  return value;
}
