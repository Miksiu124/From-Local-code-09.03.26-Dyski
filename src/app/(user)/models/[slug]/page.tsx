import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModelDetail } from "@/components/user/model-detail";
import { FolderBackdrop } from "@/components/user/folder-backdrop";
import { fetchApi } from "@/lib/api-client";
import { getSiteUrl } from "@/lib/site-url";

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
    videoCount?: number;
    imageCount?: number;
  };
};

type ContentPageResponse = {
  items: {
    id: string;
    contentType: "VIDEO" | "PHOTO";
    duration: number | null;
    /** Set when R2_PUBLIC_URL is configured (direct CDN load). */
    thumbnailUrl?: string;
  }[];
  nextCursor: string | null;
  totalCount: number;
};

type AccessResponse = {
  hasAccess: boolean;
};

type MeResponse = {
  creditBalance: number;
  role?: string;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchApi<ModelResponse>(`/models/${slug}`, { revalidate: 60 }).catch(() => null);
  if (!data?.model) return {};
  const baseUrl = getSiteUrl();
  return {
    title: data.model.name,
    description: data.model.description || `Exclusive content from ${data.model.name} on Dyskiof`,
    alternates: {
      canonical: `${baseUrl}/models/${slug}`,
    },
    openGraph: {
      title: `${data.model.name} | Dyskiof`,
      description: data.model.description || `Exclusive content from ${data.model.name}`,
      url: `${baseUrl}/models/${slug}`,
    },
  };
}

export default async function ModelDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const validSorts = ["newest", "oldest", "longest", "shortest"] as const;
  const initialSort = validSorts.includes(sp.sort as any) ? sp.sort! : "newest";
  const initialType = sp.filter === "VIDEO" || sp.filter === "PHOTO" ? sp.filter : "";

  const data = await fetchApi<ModelResponse>(`/models/${slug}`, { revalidate: 60 }).catch(() => null);

  if (!data || !data.model) {
    notFound();
  }

  const { model } = data;

  const contentQs = new URLSearchParams({ limit: "24", sort: initialSort });
  if (initialType) contentQs.set("type", initialType);

  const [contentPage, access, settings, me] = await Promise.all([
    fetchApi<ContentPageResponse>(
      `/models/${slug}/content?${contentQs.toString()}`,
      { revalidate: 60 }
    ).catch(() => ({ items: [], nextCursor: null, totalCount: 0 })),
    fetchApi<AccessResponse>(`/models/${model.id}/access`).catch(() => ({ hasAccess: false })),
    fetchApi<any>("/settings/public", { revalidate: 60 }).catch(() => ({})),
    fetchApi<MeResponse>("/auth/me").catch(() => null),
  ]);

  const cost7d = settings.model_credit_cost_7d ? Number(settings.model_credit_cost_7d) : 0;
  const cost30d = settings.model_credit_cost_30d ? Number(settings.model_credit_cost_30d) : 0;

  const hasAccess = access.hasAccess;
  const realCreditBalance = me?.creditBalance ?? 0;

  return (
    <FolderBackdrop folderName={model.folderName}>
      <ModelDetail
        model={{
          id: model.id,
          name: model.name,
          folderName: model.folderName,
          description: model.description,
          countryName: model.countryName,
          countryFlag: model.countryFlag,
          videoCount: model.videoCount,
          imageCount: model.imageCount,
        }}
        initialContentItems={contentPage.items.map((item) => ({
          id: item.id,
          contentType: item.contentType,
          duration: item.duration,
          thumbnailUrl: item.thumbnailUrl ?? null,
        }))}
        initialCursor={contentPage.nextCursor}
        totalContentCount={contentPage.totalCount}
        hasAccess={hasAccess}
        isAuthenticated={!!me}
        isAdmin={me?.role === "ADMIN"}
        cost7d={cost7d}
        cost30d={cost30d}
        creditBalance={realCreditBalance}
      />
    </FolderBackdrop>
  );
}
