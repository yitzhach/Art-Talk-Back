import { type ErrorCode, apiError } from "@studio/core";

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 428 | 429 | 500> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  needs_confirmation: 428,
  rate_limited: 429,
  internal: 500,
};

/** Throw anywhere in a handler; the app's error handler turns it into the spec's error shape. */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
  toResponse(): Response {
    return Response.json(apiError(this.code, this.message, this.details), { status: this.status });
  }
}

/** Other-studio and missing records look the same (D-016). */
export const notFound = (what = "Record") => new HttpError("not_found", `${what} not found`);
export const versionConflict = (current?: unknown) =>
  new HttpError("version_conflict", "This record changed since you loaded it", current ? { current } : undefined);
