import { ModelsGrid } from "@/components/user/models-grid";
import { fetchApi } from "@/lib/api-client";

// Define response types to safely map data
type Model = {
  id: string;
  name: string;
  folderName: string;
  description: string | null;
  countryId: string | null;
  isActive: boolean;
  countryName: string | null;
  countryFlag: string | null;
  contentCount: number;
  firstContentItemId: string | null;
};

type ModelsResponse = {
  models: Model[];
  nextCursor: string | null;
};

type Country = {
  id: string;
  name: string;
  code: string;
  flagEmoji: string;
};

type MeResponse = {
  id: string;
  email: string;
  name: string;
  role: string;
  creditBalance: number;
};

type AccessResponse = {
  hasBundle: boolean;
  modelIds: string[];
};

type StatsResponse = {
  totalModels: number;
};

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export default async function ModelsPage() {
  // Run ALL independent queries in parallel for maximum speed
  const [
    modelsData,
    countries,
    settings,
    stats,
    me,
    access,
  ] = await Promise.all([
    // Models (first page)
    withTimeout(
      fetchApi<ModelsResponse>("/models?limit=20").catch(() => ({ models: [], nextCursor: null })),
      2000,
      { models: [], nextCursor: null }
    ),
    // Countries
    withTimeout(fetchApi<Country[]>("/countries").catch(() => []), 2000, []),
    // Settings (public)
    withTimeout(fetchApi<any>("/settings/public").catch(() => ({})), 2000, {}),
    // Stats
    withTimeout(fetchApi<StatsResponse>("/models/stats").catch(() => ({ totalModels: 0 })), 2000, { totalModels: 0 }),
    // Me (Auth & Balance)
    withTimeout(fetchApi<MeResponse>("/auth/me").catch(() => null), 2000, null),
    // User Access
    withTimeout(fetchApi<AccessResponse>("/user/access").catch(() => ({ hasBundle: false, modelIds: [] })), 2000, { hasBundle: false, modelIds: [] }),
  ]);

  const cost7d = settings.model_credit_cost_7d ? Number(settings.model_credit_cost_7d) : 0;
  const cost30d = settings.model_credit_cost_30d ? Number(settings.model_credit_cost_30d) : 0;
  const bundleCreditCost = settings.bundle_credit_cost ? Number(settings.bundle_credit_cost) : 0;

  const topModelIds: string[] = []; // Not implemented in Go yet, keeping empty

  const realCreditBalance = me?.creditBalance ?? 0;
  const resolvedTotalModelCount = stats.totalModels || modelsData.models.length;

  const hasBundleAccess = access.hasBundle;
  const userAccessModelIds = hasBundleAccess
    ? ("all" as const)
    : access.modelIds;

  return (
    <div className="container mx-auto px-4 py-8">
      <ModelsGrid
        initialModels={modelsData.models.map((m) => ({
          id: m.id,
          name: m.name,
          folderName: m.folderName,
          description: m.description,
          countryId: m.countryId,
          countryName: m.countryName,
          countryFlag: m.countryFlag,
          contentCount: m.contentCount,
          isActive: m.isActive,
          firstContentItemId: m.firstContentItemId,
        }))}
        initialCursor={modelsData.nextCursor}
        totalModelCount={resolvedTotalModelCount}
        countries={countries.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          flagEmoji: c.flagEmoji,
        }))}
        cost7d={cost7d}
        cost30d={cost30d}
        bundleCreditCost={bundleCreditCost}
        topModelIds={topModelIds}
        userAccessModelIds={userAccessModelIds}
        isAuthenticated={!!me}
        creditBalance={realCreditBalance}
      />
    </div>
  );
}
