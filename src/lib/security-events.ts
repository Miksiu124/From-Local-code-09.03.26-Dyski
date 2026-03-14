/**
 * Structured security events for detection/alerting.
 * Emitted as JSON when SECURITY_EVENTS=1 or NODE_ENV=production.
 * See docs/THREAT_DETECTION_REPORT_2026-03.md
 */

const enabled =
  process.env.SECURITY_EVENTS === "1" || process.env.NODE_ENV === "production";

type SecurityEvent = {
  ts: string;
  event: string;
  ip: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export function emitSecurityEvent(
  event: string,
  ip: string,
  path: string,
  metadata?: Record<string, unknown>
): void {
  if (!enabled) return;
  const payload: SecurityEvent = {
    ts: new Date().toISOString(),
    event,
    ip,
    path,
    metadata,
  };
  try {
    console.error(`[SECURITY] ${JSON.stringify(payload)}`);
  } catch {
    // Never crash on log failure
  }
}
