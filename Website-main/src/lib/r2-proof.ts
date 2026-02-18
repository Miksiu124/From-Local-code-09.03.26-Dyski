import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getOptionalEnv } from "@/lib/env";

/**
 * Separate R2 client and bucket for payment proof uploads.
 * Falls back to the main R2 bucket (in a "proofs/" prefix) if dedicated
 * proof bucket env vars are not set.
 */

let proofClient: S3Client | null = null;

function getProofR2Client(): S3Client {
  if (proofClient) return proofClient;

  const accessKeyId =
    getOptionalEnv("R2_PROOF_ACCESS_KEY_ID") || getOptionalEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey =
    getOptionalEnv("R2_PROOF_SECRET_ACCESS_KEY") || getOptionalEnv("R2_SECRET_ACCESS_KEY");

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials for proof uploads. Set R2_PROOF_ACCESS_KEY_ID / R2_PROOF_SECRET_ACCESS_KEY or the main R2 keys."
    );
  }

  const accountId = getOptionalEnv("R2_PROOF_ACCOUNT_ID") || getOptionalEnv("R2_ACCOUNT_ID") || "";
  const endpoint =
    getOptionalEnv("R2_PROOF_ENDPOINT") ||
    getOptionalEnv("R2_ENDPOINT") ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  proofClient = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return proofClient;
}

export function getProofBucket(): string {
  return getOptionalEnv("R2_PROOF_BUCKET_NAME") || getOptionalEnv("R2_BUCKET_NAME") || "proofs";
}

/**
 * Upload a payment proof file to the proof R2 bucket.
 * Returns the key under which the file was stored.
 */
export async function uploadProofFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const client = getProofR2Client();
  const bucket = getProofBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await client.send(command);
  return key;
}
