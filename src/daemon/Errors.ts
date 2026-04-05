export class DaemonError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, string | number | boolean | null>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, string | number | boolean | null>
  ) {
    super(message);
    this.name = 'DaemonError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isNodeErrorWithCode(
  error: unknown
): error is NodeJS.ErrnoException & { code: string } {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}
