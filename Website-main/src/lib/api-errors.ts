import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "VALIDATION_ERROR";

const STATUS_MAP: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  VALIDATION_ERROR: 422,
};

/**
 * Return a consistent JSON error response.
 *
 * Usage:
 *   return jsonError("UNAUTHORIZED", "Not logged in");
 *   return jsonError("BAD_REQUEST", "Invalid email format");
 *   return jsonError("INTERNAL_ERROR", "Something went wrong", error);
 */
export function jsonError(
  code: ErrorCode,
  message: string,
  cause?: unknown
): NextResponse {
  if (cause) {
    logger.error(`[${code}] ${message}`, cause);
  }

  return NextResponse.json(
    { error: { code, message } },
    { status: STATUS_MAP[code] }
  );
}

/**
 * Shorthand helpers
 */
export const unauthorized = (msg = "Unauthorized") => jsonError("UNAUTHORIZED", msg);
export const forbidden = (msg = "Forbidden") => jsonError("FORBIDDEN", msg);
export const notFound = (msg = "Not found") => jsonError("NOT_FOUND", msg);
export const badRequest = (msg = "Bad request") => jsonError("BAD_REQUEST", msg);
export const conflict = (msg = "Conflict") => jsonError("CONFLICT", msg);
export const internalError = (msg = "Internal server error", cause?: unknown) =>
  jsonError("INTERNAL_ERROR", msg, cause);
export const validationError = (msg: string) => jsonError("VALIDATION_ERROR", msg);
