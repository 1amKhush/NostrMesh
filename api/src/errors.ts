export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function relayErrorCode(error: unknown, action: "publish" | "query"): string {
  if (error instanceof AggregateError || messageHasAllPromisesRejected(error)) {
    return `relay_${action}_failed`;
  }
  return `relay_${action}_error`;
}

export function relayErrorMessage(error: unknown, action: "publish" | "query"): string {
  const reason = errorMessage(error);
  return `Relay ${action} failed: ${reason}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Unknown error";
}

function messageHasAllPromisesRejected(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /all promises were rejected/i.test(error.message);
}
