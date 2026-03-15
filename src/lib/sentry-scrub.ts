/**
 * Sentry event scrubbing for privacy and security.
 * Redacts sensitive data before events are sent to Sentry.
 */

import type { Event } from "@sentry/core";

/** Keys that may contain sensitive values — never send to Sentry. */
const SENSITIVE_KEYS = new Set([
  "password",
  "blikCode",
  "blik_code",
  "secret",
  "token",
  "authorization",
  "cookie",
  "creditCard",
  "credit_card",
  "accessToken",
  "refreshToken",
  "apiKey",
  "api_key",
  "secretAccessKey",
  "secret_access_key",
  "session_token",
  "sessionToken",
]);

/** Regex to redact email-like strings in messages. */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Regex to redact paths that might expose internal structure. */
const ABSOLUTE_PATH_PATTERN = /[A-Za-z]:\\[^\s]+|\/[\w.-]+(?:\/[\w.-]+)+/g;

function redactString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[email redacted]")
    .replace(ABSOLUTE_PATH_PATTERN, "[path redacted]");
}

function sanitizeObject(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactString(obj);
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitizeObject(v, depth + 1));

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("secret") || lowerKey.includes("password")) {
      cleaned[key] = "[REDACTED]";
    } else {
      cleaned[key] = sanitizeObject(value, depth + 1);
    }
  }
  return cleaned;
}

/**
 * beforeSend hook: scrub sensitive data from all Sentry events.
 */
export function scrubSentryEvent<T extends Event>(event: T): T | null {
  // Scrub exception message
  if (event.exception?.values?.[0]?.value) {
    event.exception.values[0].value = redactString(event.exception.values[0].value);
  }

  // Scrub top-level message
  if (event.message) {
    event.message = redactString(event.message);
  }

  // Scrub extra/contexts
  if (event.extra && typeof event.extra === "object") {
    event.extra = sanitizeObject(event.extra) as Record<string, unknown>;
  }

  // Don't attach user PII unless explicitly needed for debugging
  if (event.user) {
    event.user = {
      id: event.user.id ?? undefined,
      ip_address: undefined, // Never send IP
      email: undefined,
      username: undefined,
    };
  }

  return event;
}
