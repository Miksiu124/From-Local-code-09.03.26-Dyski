const REQUIRED_ENV = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "NEXT_PUBLIC_APP_URL",
];

export function validateEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length === 0) return;
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}
