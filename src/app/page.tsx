import { ModelsGrid } from "@/components/user/models-grid";
import { HomeQuickActionsStrip } from "@/components/user/home-quick-actions-strip";
import { fetchApi } from "@/lib/api-client";

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
  videoCount?: number;
  imageCount?: number;
  firstContentItemId: string | null;
  avatarUrl?: string;
  headerUrl?: string;
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

export default async function HomePage() {
  const [
    modelsData,
    featuredModelsData,
    countries,
    settings,
    stats,
    me,
    access,
  ] = await Promise.all([
    withTimeout(
      fetchApi<ModelsResponse>("/models?limit=20", { revalidate: 60 }).catch(() => ({ models: [], nextCursor: null })),
      15_000,
      { models: [], nextCursor: null }
    ),
    withTimeout(
      fetchApi<ModelsResponse>("/models?featured=true&limit=10", { revalidate: 60 }).catch(() => ({ models: [], nextCursor: null })),
      15_000,
      { models: [], nextCursor: null }
    ),
    withTimeout(fetchApi<Country[]>("/countries", { revalidate: 60 }).catch(() => []), 5000, []),
    withTimeout(fetchApi<any>("/settings/public", { revalidate: 60 }).catch(() => ({})), 5000, {}),
    withTimeout(fetchApi<StatsResponse>("/models/stats", { revalidate: 60 }).catch(() => ({ totalModels: 0 })), 5000, { totalModels: 0 }),
    withTimeout(fetchApi<MeResponse>("/auth/me").catch(() => null), 5000, null),
    withTimeout(fetchApi<AccessResponse>("/user/access").catch(() => ({ hasBundle: false, modelIds: [] })), 5000, { hasBundle: false, modelIds: [] }),
  ]);

  const cost7d = settings.model_credit_cost_7d ? Number(settings.model_credit_cost_7d) : 0;
  const cost30d = settings.model_credit_cost_30d ? Number(settings.model_credit_cost_30d) : 0;
  const bundleCost14d = settings.bundle_credit_cost_14d ? Number(settings.bundle_credit_cost_14d) : 0;
  const bundleCost30d = settings.bundle_credit_cost_30d ? Number(settings.bundle_credit_cost_30d) : 0;

  const realCreditBalance = me?.creditBalance ?? 0;
  const resolvedTotalModelCount = stats.totalModels || modelsData.models.length;

  const hasBundleAccess = access.hasBundle;
  const userAccessModelIds = hasBundleAccess
    ? ("all" as const)
    : access.modelIds;

  return (
    <>
      <div className="mx-auto w-full min-w-0 max-w-[96rem] py-4 pl-[max(0.9rem,env(safe-area-inset-left,0px))] pr-[max(0.9rem,env(safe-area-inset-right,0px))] sm:py-6 md:pl-[max(1.2rem,env(safe-area-inset-left,0px))] md:pr-[max(1.2rem,env(safe-area-inset-right,0px))]">
      <HomeQuickActionsStrip
        isAuthenticated={!!me}
        creditBalance={realCreditBalance}
      />
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
          videoCount: m.videoCount,
          imageCount: m.imageCount,
          isActive: m.isActive,
          firstContentItemId: m.firstContentItemId,
          avatarUrl: m.avatarUrl,
          headerUrl: m.headerUrl,
        }))}
        featuredModels={featuredModelsData.models.map((m) => ({
          id: m.id,
          name: m.name,
          folderName: m.folderName,
          description: m.description,
          countryId: m.countryId,
          countryName: m.countryName,
          countryFlag: m.countryFlag,
          contentCount: m.contentCount,
          videoCount: m.videoCount,
          imageCount: m.imageCount,
          isActive: m.isActive,
          firstContentItemId: m.firstContentItemId,
          avatarUrl: m.avatarUrl,
          headerUrl: m.headerUrl,
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
        bundleCost14d={bundleCost14d}
        bundleCost30d={bundleCost30d}
        userAccessModelIds={userAccessModelIds}
        isAuthenticated={!!me}
        creditBalance={realCreditBalance}
      />
    </div>
    </>
  );
}
