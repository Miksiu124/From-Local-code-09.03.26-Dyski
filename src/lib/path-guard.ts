import path from "path";

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isSafeR2FolderPath(folderPath: string) {
  if (!folderPath) return false;
  if (folderPath.length > 300) return false;
  if (folderPath.includes("..") || folderPath.includes("\\") || folderPath.includes("//")) return false;
  if (folderPath.startsWith("/") || folderPath.startsWith("..")) return false;

  const normalized = path.posix.normalize(folderPath);
  if (normalized === "." || normalized === "..") return false;
  if (normalized.startsWith("../") || normalized.includes("/../")) return false;

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return false;

  return parts.every((part) => SAFE_SEGMENT_PATTERN.test(part));
}
