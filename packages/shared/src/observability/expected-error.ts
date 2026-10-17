export class ExpectedError extends Error {
  constructor(safeMessage: string, readonly status: number) {
    super(safeMessage);
    this.name = "ExpectedError";
  }
}

export function isExpectedError(error: unknown): error is ExpectedError {
  return error instanceof ExpectedError;
}
