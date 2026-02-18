import { notFound } from "next/navigation";
import { ModelDetail } from "@/components/user/model-detail";
import { fetchApi } from "@/lib/api-client";

interface Props {
  params: Promise<{ slug: string }>;
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
  contentItems: {
    id: string;
    uniqueId: string;
    contentType: "VIDEO" | "PHOTO";
    thumbnailPath: string | null;
    hlsMasterPath: string | null;
    duration: number | null;
    isActive: boolean;
    createdAt: string;
  }[];
};

type AccessResponse = {
  hasAccess: boolean;
};

type MeResponse = {
  creditBalance: number;
};

export default async function ModelDetailPage({ params }: Props) {
  const { slug } = await params;

  // 1. Fetch Model (lookup by slug)
  const data = await fetchApi<ModelResponse>(`/models/${slug}`).catch(() => null);

  if (!data || !data.model) {
    notFound();
  }

  const { model, contentItems: allContentItems } = data;

  // 2. Fetch Dependent Data in Parallel
  const [access, settings, me] = await Promise.all([
    // Check access
    fetchApi<AccessResponse>(`/models/${model.id}/access`).catch(() => ({ hasAccess: false })),
    // Settings for costs
    fetchApi<any>("/settings/public").catch(() => ({})),
    // Auth status & balance
    fetchApi<MeResponse>("/auth/me").catch(() => null),
  ]);

  const cost7d = settings.model_credit_cost_7d ? Number(settings.model_credit_cost_7d) : 0;
  const cost30d = settings.model_credit_cost_30d ? Number(settings.model_credit_cost_30d) : 0;

  const hasAccess = access.hasAccess;
  const realCreditBalance = me?.creditBalance ?? 0;

  // Pagination logic (Client-side slicing for now until backend supports content pagination)
  // The backend currently returns ALL items, so we slice the first 24 here to match original behavior.
  const initialContentItems = allContentItems.slice(0, 24);

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
        initialContentItems={initialContentItems.map((item) => ({
          id: item.id,
          contentType: item.contentType,
          thumbnailPath: item.thumbnailPath,
          duration: item.duration,
        }))}
        initialCursor={
          initialContentItems.length >= 24
            ? initialContentItems[initialContentItems.length - 1].id
            : null
        }
        totalContentCount={allContentItems.length}
        hasAccess={hasAccess}
        isAuthenticated={!!me}
        cost7d={cost7d}
        cost30d={cost30d}
        creditBalance={realCreditBalance}
      />
    </div>
  );
}
