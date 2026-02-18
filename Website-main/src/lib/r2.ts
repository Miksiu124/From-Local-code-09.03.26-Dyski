import {
  S3Client,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { requireEnv } from "@/lib/env";

function getR2Client() {
  const endpoint =
    process.env.R2_ENDPOINT ||
    `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

let r2Client: S3Client | null = null;

export function getR2() {
  if (!r2Client) {
    r2Client = getR2Client();
  }
  return r2Client;
}

export const BUCKET = requireEnv("R2_BUCKET_NAME");

function resetR2Client() {
  r2Client = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendWithRetry(command: any) {
  const client = getR2();
  try {
    return await client.send(command);
  } catch {
    resetR2Client();
    const retryClient = getR2();
    return retryClient.send(command);
  }
}

/**
 * List all "folders" (common prefixes) at a given prefix.
 */
export async function listFolders(prefix: string = ""): Promise<string[]> {
  const folders: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      Delimiter: "/",
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });

    const response = (await sendWithRetry(command)) as ListObjectsV2CommandOutput;

    if (response.CommonPrefixes) {
      for (const cp of response.CommonPrefixes) {
        if (cp.Prefix) {
          folders.push(cp.Prefix);
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return folders;
}

/**
 * List all objects under a prefix.
 */
export async function listObjects(prefix: string): Promise<{ key: string; size: number }[]> {
  const objects: { key: string; size: number }[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });

    const response = (await sendWithRetry(command)) as ListObjectsV2CommandOutput;

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Size !== undefined) {
          objects.push({ key: obj.Key, size: obj.Size });
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

/**
 * Get an object from R2 as a readable stream.
 */
export async function getObject(key: string): Promise<GetObjectCommandOutput> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return sendWithRetry(command) as Promise<GetObjectCommandOutput>;
}

/**
 * Upload an object to R2.
 */
export async function putObject(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<PutObjectCommandOutput> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  return sendWithRetry(command) as Promise<PutObjectCommandOutput>;
}

/**
 * Extract unique model folder names from R2 prefixes.
 *
 * Input:  ["adriannarodriguezz/", "abigaillutz/"]
 * Output: ["adriannarodriguezz", "abigaillutz"]
 */
export function extractFolderNames(prefixes: string[]): string[] {
  return prefixes
    .map((p) => p.replace(/\/$/, ""))
    .filter((p) => p.length > 0 && !p.includes("/"));
}

/**
 * Extract uniqueId from an R2 key that matches the pattern {uniqueId}_source/
 */
export function extractUniqueId(key: string): string | null {
  // Match pattern: anything/{uniqueId}_source/ or {uniqueId}_source/
  const match = key.match(/([a-z0-9]+)_source\//);
  return match ? match[1] : null;
}
