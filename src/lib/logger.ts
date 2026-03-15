const isProd = process.env.NODE_ENV === "production";

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
  if (typeof error === "object") return sanitize(error);
  return { value: error };
}

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
    const normalized = normalizeError(error);
    if (normalized) {
      console.error(message, normalized);
      return;
    }
    console.error(message);
  },
};
