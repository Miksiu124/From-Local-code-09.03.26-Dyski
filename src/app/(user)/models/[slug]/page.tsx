import { notFound } from "next/navigation";
import { ModelDetail } from "@/components/user/model-detail";
import { fetchApi } from "@/lib/api-client";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string; sort?: string }>;
}

type ModelResponse = {
  model: {
    id: string;
    name: string;
    folderName: string;
    description: string | null;
    avatarPath: string | null;
    countryId: string | null;
    isActive: boolean;
    countryName: string | null;
    countryFlag: string | null;
  };
  contentItems: unknown[];
};

type ContentPageResponse = {
  items: {
    id: string;
    uniqueId: string;
    contentType: "VIDEO" | "PHOTO";
    thumbnailPath: string | null;
    hlsMasterPath: string | null;
    duration: number | null;
    isActive: boolean;
    createdAt: string;
  }[];
  nextCursor: string | null;
  totalCount: number;
};

type AccessResponse = {
  hasAccess: boolean;
};

type MeResponse = {
  creditBalance: number;
};

export default async function ModelDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const validSorts = ["newest", "oldest", "longest", "shortest"] as const;
  const initialSort = validSorts.includes(sp.sort as any) ? sp.sort! : "newest";
  const initialType = sp.filter === "VIDEO" || sp.filter === "PHOTO" ? sp.filter : "";

  const data = await fetchApi<ModelResponse>(`/models/${slug}`).catch(() => null);

  if (!data || !data.model) {
    notFound();
  }

  const { model } = data;

  const contentQs = new URLSearchParams({ limit: "24", sort: initialSort });
  if (initialType) contentQs.set("type", initialType);

  const [contentPage, access, settings, me] = await Promise.all([
    fetchApi<ContentPageResponse>(
      `/models/${slug}/content?${contentQs.toString()}`
    ).catch(() => ({ items: [], nextCursor: null, totalCount: 0 })),
    fetchApi<AccessResponse>(`/models/${model.id}/access`).catch(() => ({ hasAccess: false })),
    fetchApi<any>("/settings/public").catch(() => ({})),
    fetchApi<MeResponse>("/auth/me").catch(() => null),
  ]);

  const cost7d = settings.model_credit_cost_7d ? Number(settings.model_credit_cost_7d) : 0;
  const cost30d = settings.model_credit_cost_30d ? Number(settings.model_credit_cost_30d) : 0;

  const hasAccess = access.hasAccess;
  const realCreditBalance = me?.creditBalance ?? 0;

  return (
    <div className="container mx-auto px-4 py-8">
      <ModelDetail
        model={{
          id: model.id,
          name: model.name,
          folderName: model.folderName,
          description: model.description,
          countryName: model.countryName,
          countryFlag: model.countryFlag,
        }}
        initialContentItems={contentPage.items.map((item) => ({
          id: item.id,
          contentType: item.contentType,
          thumbnailPath: item.thumbnailPath,
          duration: item.duration,
        }))}
        initialCursor={contentPage.nextCursor}
        totalContentCount={contentPage.totalCount}
        hasAccess={hasAccess}
        isAuthenticated={!!me}
        cost7d={cost7d}
        cost30d={cost30d}
        creditBalance={realCreditBalance}
      />
    </div>
  );
}
