import { cache } from "react";
import { db } from "./db";

/**
 * Cached queries that are deduped within a single React render pass.
 * React.cache ensures that if the same function is called multiple times
 * during one request, the DB is only hit once.
 */

export const getSettings = cache(async () => {
  const settings = await db.setting.findMany();
  return Object.fromEntries(
    settings.map((s) => [s.key, s.value])
  ) as Record<string, unknown>;
});

export const getCountries = cache(async () => {
  return db.country.findMany({ orderBy: { name: "asc" } });
});
