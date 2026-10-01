/** The one error shape every route returns. */
export interface ApiError {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "rate_limited"
  | "needs_confirmation"
  | "internal";

export function apiError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return { error: details ? { code, message, details } : { code, message } };
}
