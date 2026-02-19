import { describe, it, expect } from "vitest";
import { isSafeR2FolderPath } from "./path-guard";

describe("isSafeR2FolderPath", () => {
  it("accepts safe folder paths", () => {
    expect(isSafeR2FolderPath("model_123_source/")).toBe(true);
    expect(isSafeR2FolderPath("folder/subfolder/")).toBe(true);
  });

  it("rejects traversal and invalid paths", () => {
    expect(isSafeR2FolderPath("../secret/")).toBe(false);
    expect(isSafeR2FolderPath("/absolute/path/")).toBe(false);
    expect(isSafeR2FolderPath("folder/../secret/")).toBe(false);
    expect(isSafeR2FolderPath("folder//secret/")).toBe(false);
    expect(isSafeR2FolderPath("folder\\secret/")).toBe(false);
  });
});
