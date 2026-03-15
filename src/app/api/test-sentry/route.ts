import * as Sentry from "@sentry/nextjs";

export async function GET() {
  Sentry.captureMessage("Sentry production test - VPS");
  throw new Error("Sentry VPS test - if you see this in Sentry from dyskiof.net, it works!");
}
