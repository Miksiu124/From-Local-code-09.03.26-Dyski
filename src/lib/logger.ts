import * as Sentry from "@sentry/nextjs";
import { getOptionalEnv } from "@/lib/env";

const isProd = process.env.NODE_ENV === "production";
// Only use server-side DSN to avoid exposing it to the client
const sentryDsn = getOptionalEnv("SENTRY_DSN");

// ── Sentry initialization (lazy, once) ──────────────────────────────────────

let sentryInitialized = false;

function ensureSentry() {
  if (sentryInitialized) return;
  sentryInitialized = true;
  if (!sentryDsn) return;

  try {
    Sentry.init({
      dsn: sentryDsn,
      tracesSampleRate: isProd ? 0.2 : 1.0,
      environment: isProd ? "production" : "development",
      enabled: !!sentryDsn,
    });
  } catch {
    // Sentry init failure should never crash the app
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Keys that may contain sensitive values and should never be logged. */
const SENSITIVE_KEYS = new Set([
  "password", "blikCode", "blik_code", "secret", "token",
  "authorization", "cookie", "creditCard", "credit_card",
  "accessToken", "refreshToken", "apiKey", "api_key",
  "secretAccessKey", "secret_access_key",
]);

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitize(v, depth + 1));
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      cleaned[key] = "[REDACTED]";
    } else {
      cleaned[key] = sanitize(value, depth + 1);
    }
  }
  return cleaned;
}

function normalizeError(error: unknown) {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: isProd ? undefined : error.stack,
    };
  }
  // Sanitize plain objects to prevent leaking secrets
  if (typeof error === "object") return sanitize(error);
  return { value: error };
}

function captureToSentry(message: string, error?: unknown) {
  if (!sentryDsn) return;
  try {
    ensureSentry();
    if (error instanceof Error) {
      Sentry.captureException(error, { extra: { message } });
    } else {
      Sentry.captureMessage(message, {
        level: "error",
        extra: error ? { detail: error } : undefined,
      });
    }
  } catch {
    // Never let Sentry crash the app
  }
}

// ── Public logger ────────────────────────────────────────────────────────────

export const logger = {
  info(message: string, meta?: unknown) {
    if (isProd) return;
    if (meta !== undefined) {
      console.log(message, meta);
      return;
    }
    console.log(message);
  },

  warn(message: string, meta?: unknown) {
    if (isProd) return;
    if (meta !== undefined) {
      console.warn(message, meta);
      return;
    }
    console.warn(message);
  },

  error(message: string, error?: unknown) {
    // Always send to Sentry in production (if configured)
    if (isProd) {
      captureToSentry(message, error);
      console.error(message);
      return;
    }
    const normalized = normalizeError(error);
    if (normalized) {
      console.error(message, normalized);
      return;
    }
    console.error(message);
  },
};
